"""Cases router — investigation cases created by AI triage agent."""


import csv
import io
import re
import secrets
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import String, cast, delete, func, or_, select, update
from sqlalchemy import case as sql_case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import (
    AgentRun,
    AgentRunDetailResponse,
    AgentRunResponse,
    Case,
    CaseAlert,
    CaseAssign,
    CaseCreate,
    CaseDetailResponse,
    CaseEvent,
    CaseListResponse,
    CaseNoteCreate,
    CaseResponse,
    CaseTask,
    CaseTaskCreate,
    CaseTaskResponse,
    CaseTaskUpdate,
    CaseTimeline,
    CaseWatcher,
    CaseWatcherAdd,
    CaseWatcherResponse,
    MyTaskResponse,
    ReviewedAssignedTaskChange,
    ReviewedPlanTaskImport,
    SeedTasksFromPlanResponse,
    TimelineEntryResponse,
)
from backend.models.notification import Notification
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.case_linked_evidence import router as linked_evidence_router
from backend.services.audit import add_audit_log
from backend.services.case_visibility import visible_cases
from backend.services.checklist_import import checklist_proposals
from backend.services.csv_export import spreadsheet_safe_row
from backend.services.investigation_notify import notify_investigation_event
from backend.services.response_review import review_fingerprint
from backend.services.sla import sla_due_date

_SEVERITY_ORDER = ("info", "low", "medium", "high", "critical")


def _severity_rank(value: str | None) -> int:
    """Rank a case/alert severity for comparison; unknown values rank lowest."""
    try:
        return _SEVERITY_ORDER.index(str(value or "").lower())
    except ValueError:
        return -1


def _visible_cases(case_id: int, current_user: User):
    """Cases the user may open: their own, assigned to them, watched by
    them, or carrying a checklist task assigned to them."""
    return visible_cases(case_id, current_user)


_MENTION_RE = re.compile(r"@([A-Za-z0-9._-]+)")


router = APIRouter()
router.include_router(linked_evidence_router)


def _case_keyword_filter(search: str):
    needle = search.strip().lower()
    return or_(
        func.lower(Case.title).contains(needle, autoescape=True),
        func.lower(func.coalesce(Case.summary, "")).contains(needle, autoescape=True),
        cast(Case.id, String).contains(needle, autoescape=True),
    )


@router.get("/", response_model=CaseListResponse)
async def list_cases(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    severity: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    assigned: str | None = Query(
        None, pattern="^(me|unassigned)$", description="Filter by assignment: 'me' or 'unassigned'"
    ),
    watching: str | None = Query(
        None, pattern="^(me)$", description="'me' lists only cases the user watches"
    ),
    overdue: bool = Query(False, description="Only open cases past their due date"),
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|severity_desc|severity_asc|due_date_asc|due_date_desc)$",
        description="Sort order"
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List investigation cases with pagination and filters."""
    skip = (page - 1) * size

    if watching == "me":
        # "Watched by me" spans the org: any case the user follows as a watcher.
        watched = select(CaseWatcher.case_id).where(CaseWatcher.user_id == current_user.id)
        query = select(Case).options(joinedload(Case.assignee)).where(Case.id.in_(watched))
        count_q = select(func.count(Case.id)).where(Case.id.in_(watched))
    elif assigned == "me":
        # "My assignments" spans the org: cases others assigned to me, not just my own.
        query = select(Case).options(joinedload(Case.assignee)).where(Case.assigned_to_id == current_user.id)
        count_q = select(func.count(Case.id)).where(Case.assigned_to_id == current_user.id)
    else:
        query = select(Case).options(joinedload(Case.assignee)).where(Case.user_id == current_user.id)
        count_q = select(func.count(Case.id)).where(Case.user_id == current_user.id)

    if search and search.strip():
        predicate = _case_keyword_filter(search)
        query = query.filter(predicate)
        count_q = count_q.filter(predicate)
    if severity:
        query = query.filter(Case.severity == severity)
        count_q = count_q.filter(Case.severity == severity)
    if status_filter:
        query = query.filter(Case.status == status_filter)
        count_q = count_q.filter(Case.status == status_filter)
    if assigned == "me":
        query = query.filter(Case.assigned_to_id == current_user.id)
        count_q = count_q.filter(Case.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Case.assigned_to_id.is_(None))
        count_q = count_q.filter(Case.assigned_to_id.is_(None))
    if overdue:
        today = datetime.now(UTC).date()
        done_statuses = ("resolved", "closed", "false_positive")
        query = query.filter(
            Case.due_date.isnot(None), Case.due_date < today,
            Case.status.notin_(done_statuses),
        )
        count_q = count_q.filter(
            Case.due_date.isnot(None), Case.due_date < today,
            Case.status.notin_(done_statuses),
        )

    total = (await db.execute(count_q)).scalar_one()
    severity_rank = sql_case(
        {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0},
        value=Case.severity,
        else_=2
    )
    order_columns = {
        "created_at_desc": [Case.created_at.desc()],
        "created_at_asc": [Case.created_at.asc()],
        "severity_desc": [severity_rank.desc(), Case.created_at.desc()],
        "severity_asc": [severity_rank.asc(), Case.created_at.desc()],
        "due_date_asc": [Case.due_date.asc().nulls_last(), Case.created_at.desc()],
        "due_date_desc": [Case.due_date.desc().nulls_last(), Case.created_at.desc()],
    }
    query = query.order_by(*order_columns[sort], Case.id.desc()).offset(skip).limit(size)
    cases = (await db.execute(query)).scalars().all()

    # Keep enrichment bounded to the visible page, without two queries per case.
    case_ids = [case.id for case in cases]
    alert_counts = dict((await db.execute(
        select(CaseAlert.case_id, func.count(func.distinct(Alert.id)))
        .join(Alert, Alert.id == CaseAlert.alert_id).join(Case, Case.id == CaseAlert.case_id)
        .where(CaseAlert.case_id.in_(case_ids), Alert.user_id == Case.user_id).group_by(CaseAlert.case_id)
    )).all()) if case_ids else {}
    event_counts = dict((await db.execute(
        select(CaseEvent.case_id, func.count(func.distinct(SecurityEvent.id)))
        .join(SecurityEvent, SecurityEvent.id == CaseEvent.event_id).join(Case, Case.id == CaseEvent.case_id)
        .where(CaseEvent.case_id.in_(case_ids), SecurityEvent.user_id == Case.user_id).group_by(CaseEvent.case_id)
    )).all()) if case_ids else {}
    case_responses = []
    for case in cases:
        resp = CaseResponse.model_validate(case)
        resp.alert_count = alert_counts.get(case.id, 0)
        resp.event_count = event_counts.get(case.id, 0)
        resp.assigned_to_email = case.assignee.email if case.assignee else None
        case_responses.append(resp)

    return CaseListResponse(cases=case_responses, total=total, page=page, size=size)


@router.get("/export")
async def export_cases(
    search: str | None = Query(None, max_length=200),
    severity: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    assigned: str | None = Query(None, pattern="^(me|unassigned)$"),
    watching: str | None = Query(None, pattern="^(me)$"),
    overdue: bool = Query(False),
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|severity_desc|severity_asc|due_date_asc|due_date_desc)$",
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export the filtered investigations list as CSV (same filters as the list, up to 5000 rows, never silently truncated)."""
    alert_counts = (
        select(func.count(func.distinct(Alert.id))).select_from(CaseAlert)
        .join(Alert, Alert.id == CaseAlert.alert_id)
        .where(CaseAlert.case_id == Case.id, Alert.user_id == Case.user_id).correlate(Case).scalar_subquery()
    )
    event_counts = (
        select(func.count(func.distinct(SecurityEvent.id))).select_from(CaseEvent)
        .join(SecurityEvent, SecurityEvent.id == CaseEvent.event_id)
        .where(CaseEvent.case_id == Case.id, SecurityEvent.user_id == Case.user_id).correlate(Case).scalar_subquery()
    )
    base_query = (
        select(Case, alert_counts.label("alert_count"), event_counts.label("event_count"))
        .options(joinedload(Case.assignee))
    )
    if watching == "me":
        watched = select(CaseWatcher.case_id).where(CaseWatcher.user_id == current_user.id)
        query = base_query.where(Case.id.in_(watched))
    elif assigned == "me":
        query = base_query.where(Case.assigned_to_id == current_user.id)
    else:
        query = base_query.where(Case.user_id == current_user.id)

    if search and search.strip():
        query = query.filter(_case_keyword_filter(search))
    if severity:
        query = query.filter(Case.severity == severity)
    if status_filter:
        query = query.filter(Case.status == status_filter)
    if assigned == "me":
        query = query.filter(Case.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Case.assigned_to_id.is_(None))
    if overdue:
        today = datetime.now(UTC).date()
        done_statuses = ("resolved", "closed", "false_positive")
        query = query.filter(
            Case.due_date.isnot(None), Case.due_date < today,
            Case.status.notin_(done_statuses),
        )

    severity_rank = sql_case(
        {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0},
        value=Case.severity,
        else_=2
    )
    order_columns = {
        "created_at_desc": [Case.created_at.desc()],
        "created_at_asc": [Case.created_at.asc()],
        "severity_desc": [severity_rank.desc(), Case.created_at.desc()],
        "severity_asc": [severity_rank.asc(), Case.created_at.desc()],
        "due_date_asc": [Case.due_date.asc().nulls_last(), Case.created_at.desc()],
        "due_date_desc": [Case.due_date.desc().nulls_last(), Case.created_at.desc()],
    }
    query = query.order_by(*order_columns[sort], Case.id.desc()).limit(5001)
    rows = (await db.execute(query)).all()
    if len(rows) > 5000:
        raise HTTPException(status_code=422, detail=(
            "The filtered cases export exceeds 5,000 records. Narrow the applied filters and retry. "
            "No partial CSV was created."))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "title", "summary", "severity", "status", "confidence_score",
        "alert_count", "event_count", "assigned_to_email", "due_date", "created_by", "created_at",
    ])
    for row in rows:
        case = row.Case
        writer.writerow(spreadsheet_safe_row([
            case.id,
            case.title,
            case.summary or "",
            case.severity,
            case.status,
            case.confidence_score if case.confidence_score is not None else "",
            row.alert_count,
            row.event_count,
            case.assignee.email if case.assignee else "",
            case.due_date.isoformat() if case.due_date else "",
            case.created_by,
            case.created_at.isoformat() if case.created_at else "",
        ]))
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cases.csv"},
    )


@router.post("/", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    case_data: CaseCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Open an investigation manually."""
    title = case_data.title.strip()
    if not title:
        raise HTTPException(
            status_code=422,
            detail="Title must not be blank",
        )
    summary = (case_data.summary or "").strip() or None
    case = Case(
        user_id=current_user.id,
        title=title,
        summary=summary,
        severity=case_data.severity,
        status="open",
        created_by="human",
        due_date=sla_due_date(current_user, case_data.severity),
    )
    db.add(case)
    await db.flush()
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="note",
        content=f"Investigation opened manually by {current_user.email}.",
        source="human",
    ))
    add_audit_log(
        db,
        user_id=current_user.id,
        action="case_created",
        target_type="case",
        target_id=case.id,
        detail=f"Case '{title}' opened manually",
    )
    await db.commit()
    await db.refresh(case)
    resp = CaseResponse.model_validate(case)
    resp.alert_count = 0
    resp.event_count = 0
    return resp


# --- Semantic Search (MUST be before /{case_id} to avoid route conflict) ---

@router.get("/search")
async def search_cases_endpoint(
    q: str = Query(..., min_length=2),
    max_results: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Search cases by natural language query."""
    from backend.services.semantic_search import search_cases
    results = await search_cases(db=db, user_id=current_user.id, query=q, max_results=max_results)
    return {"success": True, "data": results, "query": q}


def _assigned_task_query(current_user: User, completion: str = "open", investigations: str = "active"):
    watched = select(CaseWatcher.case_id).where(CaseWatcher.user_id == current_user.id)
    tasked = select(CaseTask.case_id).where(CaseTask.assignee_id == current_user.id)
    severity_order = sql_case(
        (Case.severity == "critical", 0), (Case.severity == "high", 1),
        (or_(Case.severity == "medium", Case.severity.is_(None), Case.severity == ""), 2),
        (Case.severity == "low", 3), (Case.severity == "info", 4), else_=5,
    )
    statement = (
        select(CaseTask, Case)
        .join(Case, Case.id == CaseTask.case_id)
        .where(
            CaseTask.assignee_id == current_user.id,
            or_(
                Case.user_id == current_user.id,
                Case.assigned_to_id == current_user.id,
                Case.id.in_(watched),
                Case.id.in_(tasked),
            ),
        )
        .order_by(
            severity_order, Case.due_date.is_(None), Case.due_date,
            CaseTask.due_date.is_(None), CaseTask.due_date, CaseTask.position, CaseTask.id,
        )
    )

    if completion != "all":
        statement = statement.where(CaseTask.done == (completion == "completed"))
    if investigations != "all":
        inactive = Case.status.in_(("resolved", "closed", "false_positive"))
        statement = statement.where(inactive if investigations == "inactive" else ~inactive)
    return statement


def _assigned_task_rows(rows):
    return [
        MyTaskResponse(
            task_id=task.id,
            case_id=case.id,
            case_title=case.title,
            case_severity=case.severity or "medium",
            case_status=case.status,
            case_due_date=case.due_date,
            title=task.title,
            due_date=task.due_date,
            created_at=task.created_at,
        )
        for task, case in rows
    ]



@router.get("/my-tasks", response_model=list[MyTaskResponse])
async def list_my_tasks(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Legacy assigned-task snapshot, limited to 200 records for compatibility."""
    rows = (await db.execute(_assigned_task_query(current_user).limit(200))).all()
    return _assigned_task_rows(rows)


@router.get("/assigned-task-explorer")
async def explore_assigned_tasks(
    page: int = Query(1, ge=1), size: int = Query(25, ge=1, le=100),
    query: str = Query("", max_length=200),
    severity: Literal["all", "critical", "high", "medium", "low", "info"] = "all",
    due: Literal["all", "overdue", "today", "future", "none"] = "all",
    today: date | None = None,
    completion: Literal["open", "completed", "all"] = "open",
    investigations: Literal["active", "inactive", "all"] = "active",
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Read current assigned-task records, including explicit completed/inactive scopes."""
    statement = _assigned_task_query(current_user, completion, investigations)
    if query.strip():
        needle = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{needle}%"
        statement = statement.where(or_(CaseTask.title.ilike(pattern, escape="\\"),
                                         Case.title.ilike(pattern, escape="\\"),
                                         cast(CaseTask.id, String).ilike(pattern, escape="\\"),
                                         cast(Case.id, String).ilike(pattern, escape="\\")))
    if severity != "all":
        statement = statement.where(or_(Case.severity == "medium", Case.severity.is_(None), Case.severity == "")
                                    if severity == "medium" else Case.severity == severity)
    if due == "none":
        statement = statement.where(CaseTask.due_date.is_(None))
    elif due != "all":
        if today is None:
            raise HTTPException(status_code=422, detail="Supply the calendar date used for due filtering")
        statement = statement.where(CaseTask.due_date < today if due == "overdue" else
                                    CaseTask.due_date == today if due == "today" else CaseTask.due_date > today)
    matched = statement.order_by(None).with_only_columns(
        CaseTask.case_id.label("case_id"), CaseTask.done.label("done"),
        CaseTask.due_date.label("due_date"), CaseTask.completed_at.label("completed_at"),
        maintain_column_froms=True,
    ).subquery()
    counts = (await db.execute(select(
        func.count().label("total"), func.count(func.distinct(matched.c.case_id)).label("investigations"),
        func.count().filter(matched.c.done.is_(False)).label("open"),
        func.count().filter(matched.c.done.is_(True)).label("completed"),
        func.count().filter(matched.c.due_date.is_(None)).label("without_due_date"),
        func.count().filter(matched.c.done.is_(True), matched.c.completed_at.is_(None))
        .label("completed_without_timestamp"),
    ).select_from(matched))).mappings().one()
    total = counts["total"]
    rows = (await db.execute(statement.offset((page - 1) * size).limit(size))).all()
    records = [dict(row.model_dump(), done=task.done, completed_at=task.completed_at)
               for row, (task, _case) in zip(_assigned_task_rows(rows), rows, strict=True)]
    return {"data": records, "total": total, "summary": dict(counts), "page": page, "size": size,
            "filter_date": today, "completion": completion, "investigations": investigations,
            "scope": "Current records assigned to your account on currently visible investigations. "
                     "Not assignment history or proof of external remediation."}


@router.patch("/assigned-task-explorer/{task_id}", response_model=CaseTaskResponse)
async def change_reviewed_assigned_task(
    task_id: int, payload: ReviewedAssignedTaskChange,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Edit exactly one currently self-assigned task using its reviewed state."""
    if (payload.action == "set_due" and payload.due_date is None) or (
        payload.action != "set_due" and payload.due_date is not None
    ):
        raise HTTPException(status_code=422, detail="Supply a date only for the set-due action")
    case = (await db.execute(_visible_cases(payload.case_id, current_user).with_for_update())).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Assigned task not found")
    if case.title != payload.expected_case_title or case.status != payload.expected_case_status:
        raise HTTPException(status_code=409, detail="The investigation changed. Refresh tasks and review again.")
    if payload.action in {"complete", "reopen"} and payload.expected_done == (payload.action == "complete"):
        raise HTTPException(status_code=422, detail="Select a change from the reviewed completion state")
    values = {}
    if payload.action in {"complete", "reopen"}:
        values = {"done": payload.action == "complete",
                  "completed_at": datetime.now(UTC) if payload.action == "complete" else None}
        note = f"Task {'completed' if values['done'] else 'reopened'}: {payload.expected_title}"
    else:
        new_date = payload.due_date if payload.action == "set_due" else None
        if new_date == payload.expected_due_date:
            raise HTTPException(status_code=422, detail="Select a different task due date")
        values = {"due_date": new_date, "due_soon_notified_at": None, "overdue_notified_at": None}
        note = (f"Task due date set to {new_date.isoformat()}: {payload.expected_title}" if new_date
                else f"Task due date cleared: {payload.expected_title}")
    # A single conditional update rejects changed/reassigned/deleted tasks even when
    # another writer committed after the user loaded their review snapshot.
    changed = await db.execute(update(CaseTask).where(
        CaseTask.id == task_id, CaseTask.case_id == case.id, CaseTask.assignee_id == current_user.id,
        CaseTask.title == payload.expected_title, CaseTask.done == payload.expected_done,
        CaseTask.due_date == payload.expected_due_date,
    ).values(**values).execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail=(
            "The assigned task changed or is no longer assigned to you. Refresh tasks and review again."))
    db.add(CaseTimeline(case_id=case.id, entry_type="action", content=note, source="human", user_id=current_user.id))
    await db.commit()
    return (await db.execute(select(CaseTask).where(CaseTask.id == task_id)
                            .execution_options(populate_existing=True))).scalar_one()


@router.get("/watched-record-explorer")
async def explore_watched_records(
    page: int = Query(1, ge=1), size: int = Query(25, ge=1, le=100),
    query: str = Query("", max_length=200),
    kind: Literal["all", "alert", "case"] = "all",
    severity: Literal["all", "critical", "high", "medium", "low", "info"] = "all",
    scope: Literal["all", "active", "done", "overdue"] = "all",
    sort: Literal["severity", "newest", "oldest", "name", "due"] = "severity",
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Search the complete current watchlist without loading every page into the browser."""
    from backend.services.watchlist_search import search_watched_records

    return await search_watched_records(db, current_user.id, page=page, size=size, query=query,
                                       kind=kind, severity=severity, scope=scope, sort=sort)


@router.get("/{case_id}", response_model=CaseDetailResponse)
async def get_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get case detail with timeline."""
    case = (await db.execute(
        _visible_cases(case_id, current_user).options(joinedload(Case.assignee))
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # Get timeline
    timeline = (await db.execute(
        select(CaseTimeline)
        .where(CaseTimeline.case_id == case_id)
        .order_by(CaseTimeline.timestamp)
    )).scalars().all()
    author_ids = {entry.user_id for entry in timeline if entry.user_id is not None}
    if author_ids:
        authors = (await db.execute(
            select(User.id, User.email).where(User.id.in_(author_ids))
        )).all()
        email_by_id = dict(authors)
        for entry in timeline:
            entry.author_email = email_by_id.get(entry.user_id)

    # Get counts
    alert_count = (await db.execute(
        select(func.count(func.distinct(Alert.id))).select_from(CaseAlert)
        .join(Alert, Alert.id == CaseAlert.alert_id)
        .where(CaseAlert.case_id == case_id, Alert.user_id == case.user_id)
    )).scalar_one()
    event_count = (await db.execute(
        select(func.count(func.distinct(SecurityEvent.id))).select_from(CaseEvent)
        .join(SecurityEvent, SecurityEvent.id == CaseEvent.event_id)
        .where(CaseEvent.case_id == case_id, SecurityEvent.user_id == case.user_id)
    )).scalar_one()

    resp = CaseDetailResponse.model_validate(case)
    resp.alert_count = alert_count
    resp.event_count = event_count
    resp.assigned_to_email = case.assignee.email if case.assignee else None
    resp.timeline = [TimelineEntryResponse.model_validate(t) for t in timeline]
    return resp


@router.get("/{case_id}/export")
async def export_case_timeline(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export the case timeline as CSV for incident reports."""
    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    timeline = (await db.execute(
        select(CaseTimeline)
        .where(CaseTimeline.case_id == case.id)
        .order_by(CaseTimeline.timestamp)
    )).scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["case_id", "case_title", "timestamp", "entry_type", "source", "content"])
    for entry in timeline:
        writer.writerow(spreadsheet_safe_row([
            case.id,
            case.title,
            entry.timestamp.isoformat() if entry.timestamp else "",
            entry.entry_type,
            entry.source,
            entry.content,
        ]))
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename=case-{case.id}-timeline.csv'},
    )


@router.post("/{case_id}/notes", response_model=TimelineEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_case_note(
    case_id: int,
    note: CaseNoteCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Add an investigator note to the case timeline."""
    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    content = note.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Note must not be blank")
    entry = CaseTimeline(
        case_id=case.id,
        entry_type="note",
        content=content,
        source="human",
        user_id=current_user.id,
    )
    db.add(entry)
    await db.flush()  # entry.id feeds the mention deep links below

    # @mentions: "@will" pings will@<org> and, when the author can share the
    # case (owner or assignee), adds them as a watcher so the link works and
    # they follow the rest of the investigation.
    mention_hits = {token.lower() for token in _MENTION_RE.findall(content)}
    notified: list[User] = []
    if mention_hits and current_user.org_id is not None:
        org_members = (await db.execute(
            select(User).where(
                User.org_id == current_user.org_id,
                User.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        targets = [
            u for u in org_members
            if u.id != current_user.id and u.email.split("@", 1)[0].lower() in mention_hits
        ]
        if targets:
            watcher_rows = (await db.execute(
                select(CaseWatcher.user_id).where(CaseWatcher.case_id == case.id)
            )).scalars().all()
            watcher_ids = set(watcher_rows)
            can_share = current_user.id in (case.user_id, case.assigned_to_id)
            excerpt = content if len(content) <= 140 else content[:137] + "..."
            for target in targets:
                has_access = (
                    target.id in (case.user_id, case.assigned_to_id)
                    or target.id in watcher_ids
                )
                if not has_access:
                    if not can_share:
                        continue  # a watcher cannot pull new people into the case
                    db.add(CaseWatcher(case_id=case.id, user_id=target.id))
                    watcher_ids.add(target.id)
                db.add(Notification(
                    user_id=target.id,
                    kind="case_mention",
                    title=f"{current_user.email} mentioned you in case #{case.id}",
                    body=excerpt,
                    link=f"/app/cases/{case.id}?note={entry.id}",
                ))
                notified.append(target)

    await db.commit()
    await db.refresh(entry)

    for target in notified:
        await notify_investigation_event(
            target,
            kind="case_mention",
            severity=case.severity,
            title=f"{current_user.email} mentioned you in case #{case.id}",
            body=f"{case.title}. Open the case to read the note.",
            link_path=f"/app/cases/{case.id}?note={entry.id}",
        )
    return entry


@router.patch("/{case_id}/notes/{entry_id}", response_model=TimelineEntryResponse)
async def update_case_note(
    case_id: int,
    entry_id: int,
    note: CaseNoteCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Edit an investigator note on the case timeline.

    Only timeline entries of type ``note`` are editable; system and agent
    entries form the investigation's audit trail and stay immutable.
    """
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    entry = (await db.execute(
        select(CaseTimeline).where(CaseTimeline.id == entry_id, CaseTimeline.case_id == case.id)
    )).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if entry.entry_type != "note":
        raise HTTPException(status_code=422, detail="Only investigator notes can be edited")

    content = note.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Note must not be blank")

    entry.content = content
    entry.metadata_json = {**(entry.metadata_json or {}), "edited": True}
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{case_id}/notes/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case_note(
    case_id: int,
    entry_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete an investigator note from the case timeline.

    Only entries of type ``note`` can be deleted; system and agent
    entries form the investigation's audit trail and stay immutable.
    """
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    entry = (await db.execute(
        select(CaseTimeline).where(CaseTimeline.id == entry_id, CaseTimeline.case_id == case.id)
    )).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if entry.entry_type != "note":
        raise HTTPException(status_code=422, detail="Only investigator notes can be deleted")

    await db.delete(entry)
    await db.commit()


# --- Investigation task checklist ---


async def _get_visible_case(
    db: AsyncSession, case_id: int, current_user: User, *, write: bool = False
) -> Case:
    query = _visible_cases(case_id, current_user)
    if write:
        query = query.with_for_update()
    case = (await db.execute(query)).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _can_manage_checklist(case: Case, current_user: User) -> bool:
    return case.user_id == current_user.id or case.assigned_to_id == current_user.id


def _require_checklist_manager(case: Case, current_user: User):
    if not _can_manage_checklist(case, current_user):
        raise HTTPException(status_code=403, detail="Only the investigation owner or assignee can manage its checklist")


async def _get_case_task(db: AsyncSession, case_id: int, task_id: int) -> CaseTask:
    task = (await db.execute(
        select(CaseTask).where(CaseTask.id == task_id, CaseTask.case_id == case_id).with_for_update()
    )).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


async def _validate_task_assignee(db: AsyncSession, assignee_id: int, current_user: User) -> User:
    """Return the assignee, who must be an active member of the user's org."""
    assignee = (await db.execute(
        select(User).where(User.id == assignee_id, User.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    wrong_org = (
        current_user.org_id is not None
        and assignee is not None
        and assignee.org_id != current_user.org_id
    )
    no_org = current_user.org_id is None and assignee_id != current_user.id
    if assignee is None or wrong_org or no_org:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assignee must be an active member of your organization",
        )
    return assignee


@router.get("/{case_id}/tasks", response_model=list[CaseTaskResponse])
async def list_case_tasks(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the investigation checklist for a case, in checklist order."""
    case = await _get_visible_case(db, case_id, current_user)
    return (await db.execute(
        select(CaseTask)
        .where(CaseTask.case_id == case.id)
        .order_by(CaseTask.position, CaseTask.id)
    )).scalars().all()


@router.post("/{case_id}/tasks", response_model=CaseTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_case_task(
    case_id: int,
    payload: CaseTaskCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Add a task to the end of the case checklist."""
    case = await _get_visible_case(db, case_id, current_user, write=True)
    _require_checklist_manager(case, current_user)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Task title must not be blank")
    next_position = (await db.execute(
        select(func.coalesce(func.max(CaseTask.position), -1)).where(CaseTask.case_id == case.id)
    )).scalar_one() + 1
    if payload.assignee_id is not None:
        await _validate_task_assignee(db, payload.assignee_id, current_user)
    task = CaseTask(
        case_id=case.id,
        title=title,
        position=next_position,
        assignee_id=payload.assignee_id,
        due_date=payload.due_date,
        created_by_id=current_user.id,
    )
    db.add(task)
    if payload.assignee_id is not None and payload.assignee_id != current_user.id:
        db.add(Notification(
            user_id=payload.assignee_id,
            kind="case_task_assigned",
            title=f"Task assigned: {title}",
            body=f"Investigation #{case.id}: {case.title}",
            link=f"/app/cases/{case.id}",
        ))
    await db.commit()
    await db.refresh(task)
    return task


@router.patch("/{case_id}/tasks/{task_id}", response_model=CaseTaskResponse)
async def update_case_task(
    case_id: int,
    task_id: int,
    payload: CaseTaskUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Rename, reassign, or toggle a task's done state.

    Completing, reopening, assigning, or unassigning a task is recorded on
    the case timeline so the investigation keeps an audit trail of
    checklist progress. Send ``assignee_id: null`` to unassign.
    """
    case = await _get_visible_case(db, case_id, current_user, write=True)
    task = await _get_case_task(db, case.id, task_id)
    if not _can_manage_checklist(case, current_user) and (
        task.assignee_id != current_user.id or payload.model_fields_set - {"done", "due_date"}
    ):
        raise HTTPException(status_code=403, detail=(
            "You can only change completion or due dates on checklist tasks currently assigned to you"))


    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Task title must not be blank")
        task.title = title

    timeline_notes: list[str] = []
    if payload.done is not None and payload.done != task.done:
        task.done = payload.done
        task.completed_at = datetime.now(UTC) if payload.done else None
        timeline_notes.append(f"Task {'completed' if payload.done else 'reopened'}: {task.title}")

    if "assignee_id" in payload.model_fields_set and payload.assignee_id != task.assignee_id:
        assignee = None
        if payload.assignee_id is not None:
            assignee = await _validate_task_assignee(db, payload.assignee_id, current_user)
        task.assignee_id = payload.assignee_id
        timeline_notes.append(
            f"Task assigned to {assignee.email}: {task.title}"
            if assignee is not None
            else f"Task unassigned: {task.title}"
        )
        if assignee is not None and assignee.id != current_user.id:
            db.add(Notification(
                user_id=assignee.id,
                kind="case_task_assigned",
                title=f"Task assigned: {task.title}",
                body=f"Investigation #{case.id}: {case.title}",
                link=f"/app/cases/{case.id}",
            ))

    if "due_date" in payload.model_fields_set and payload.due_date != task.due_date:
        task.due_date = payload.due_date
        task.due_soon_notified_at = None
        task.overdue_notified_at = None
        timeline_notes.append(
            f"Task due date set to {payload.due_date.isoformat()}: {task.title}"
            if payload.due_date is not None
            else f"Task due date cleared: {task.title}"
        )

    for note in timeline_notes:
        db.add(CaseTimeline(
            case_id=case.id,
            entry_type="action",
            content=note,
            source="human",
            user_id=current_user.id,
        ))

    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/{case_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case_task(
    case_id: int,
    task_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove a task from the case checklist."""
    case = await _get_visible_case(db, case_id, current_user, write=True)
    _require_checklist_manager(case, current_user)
    task = await _get_case_task(db, case.id, task_id)
    await db.delete(task)
    await db.commit()


@router.get("/{case_id}/tasks/from-plan/{plan_id}/preview")
async def preview_case_tasks_from_plan(
    case_id: int,
    plan_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Preview checklist-only proposals under existing case access rules."""
    case = await _get_visible_case(db, case_id, current_user)
    plan = (
        await db.execute(
            select(ResponsePlan).where(
                ResponsePlan.id == plan_id,
                ResponsePlan.case_id == case.id,
                ResponsePlan.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Response plan not found")
    if not isinstance(plan.actions, list) or len(plan.actions) > 200:
        raise HTTPException(status_code=400, detail="This saved plan cannot be safely previewed as a checklist")
    existing = set((await db.execute(select(CaseTask.title).where(CaseTask.case_id == case.id))).scalars().all())
    return {
        "case_id": case.id,
        "plan_id": plan.id,
        "plan_status": plan.status,
        "review_fingerprint": review_fingerprint(plan),
        "proposals": checklist_proposals(plan.actions, existing),
        "scope": ("Creates unchecked checklist tasks only. No response approval, execution or external action. "
                  "Existing titles are rechecked when adding tasks."),
    }


@router.post(
    "/{case_id}/tasks/from-plan/{plan_id}",
    response_model=SeedTasksFromPlanResponse,
    status_code=status.HTTP_201_CREATED,
)
async def seed_case_tasks_from_plan(
    case_id: int,
    plan_id: int,
    payload: ReviewedPlanTaskImport | None = None,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Turn a response plan's actions into checklist tasks on the case.

    Actions are added in priority order as ``action_type: target`` titles.
    Re-seeding skips actions already on the checklist, so an updated plan
    only adds its new steps.
    """
    case = await _get_visible_case(db, case_id, current_user, write=True)
    _require_checklist_manager(case, current_user)
    # Serialize all imports on the case, including legacy bodyless requests.
    await db.execute(select(Case.id).where(Case.id == case.id).with_for_update())
    plan = (await db.execute(select(ResponsePlan).where(
        ResponsePlan.id == plan_id, ResponsePlan.case_id == case.id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if plan is None or (payload is not None and plan.user_id != current_user.id):
        raise HTTPException(status_code=404, detail="Response plan not found")

    selected_indexes = None
    if payload is not None:
        if not secrets.compare_digest(payload.reviewed_fingerprint, review_fingerprint(plan)):
            raise HTTPException(
                status_code=409,
                detail="The saved plan changed. Refresh the checklist preview and choose actions again.",
            )
        if not isinstance(plan.actions, list) or len(plan.actions) > 200:
            raise HTTPException(status_code=400, detail="This saved plan cannot be safely imported")
        selected_indexes = set(payload.action_indexes)
        if len(selected_indexes) != len(payload.action_indexes) or any(
            i < 0 or i >= len(plan.actions) for i in selected_indexes
        ):
            raise HTTPException(status_code=422, detail="Select unique action indexes from this saved plan")

    def _task_title(action: dict) -> str:
        action_type = str(action.get("action_type", "action"))
        target = str(action.get("target", ""))
        title = f"{action_type}: {target}" if target else action_type
        return title[:300]

    actions = [a for a in (plan.actions or []) if isinstance(a, dict)]
    actions.sort(
        key=lambda a: (
            a.get("priority")
            if isinstance(a.get("priority"), (int, float)) and not isinstance(a.get("priority"), bool)
            else 1000
        )
    )

    existing_titles = set((await db.execute(select(CaseTask.title).where(CaseTask.case_id == case.id))).scalars().all())
    next_position = (
        await db.execute(select(func.coalesce(func.max(CaseTask.position), -1)).where(CaseTask.case_id == case.id))
    ).scalar_one() + 1

    if selected_indexes is not None:
        proposals = checklist_proposals(plan.actions, existing_titles)
        selected = [row for row in proposals if row["action_index"] in selected_indexes]
        if any(not row["title"] for row in selected):
            raise HTTPException(status_code=400, detail="A selected saved action has no usable checklist title")
        actions = [{"_reviewed_title": row["title"], "_action_index": row["action_index"]} for row in selected]

    created: list[CaseTask] = []
    created_indexes: list[int] = []
    skipped = 0
    for action in actions:
        title = action["_reviewed_title"] if selected_indexes is not None else _task_title(action)
        if title in existing_titles:
            skipped += 1
            continue
        task = CaseTask(
            case_id=case.id,
            title=title,
            position=next_position,
            created_by_id=current_user.id,
        )
        next_position += 1
        existing_titles.add(title)
        db.add(task)
        created.append(task)
        if selected_indexes is not None:
            created_indexes.append(action["_action_index"])

    if created:
        await db.flush()
        import_metadata = None
        if payload is not None:
            import_metadata = {
                "kind": "reviewed_checklist_import", "schema_version": 1,
                "case_id": case.id, "plan_id": plan.id,
                "reviewed_fingerprint": payload.reviewed_fingerprint,
                "selected_action_indexes": payload.action_indexes,
                "skipped_existing_titles": skipped,
                "created_tasks": [{"task_id": task.id, "action_index": index, "title_at_import": task.title}
                                  for task, index in zip(created, created_indexes, strict=True)],
            }
        suffix = "s" if len(created) != 1 else ""
        db.add(
            CaseTimeline(
                case_id=case.id,
                entry_type="action",
                content=f"Checklist seeded from response plan #{plan.id}: {len(created)} task{suffix}",
                source="human",
                user_id=current_user.id,
                metadata_json=import_metadata,
            )
        )
    await db.commit()
    for task in created:
        await db.refresh(task)
    return SeedTasksFromPlanResponse(created=created, skipped=skipped)


@router.get("/{case_id}/closeout-review")
async def preview_case_closeout(
    case_id: int, target_status: Literal["resolved", "closed", "false_positive"],
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    from backend.services.case_close_review import closeout_review

    case = await _get_visible_case(db, case_id, current_user)
    if case.user_id != current_user.id and case.assigned_to_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the investigation owner or assignee can review close-out")
    if case.status == target_status:
        raise HTTPException(status_code=409, detail="The investigation already has that status. Refresh the case.")
    return await closeout_review(db, case, current_user.id, target_status)


@router.patch("/{case_id}")
async def update_case(
    case_id: int,
    status_update: str | None = None,
    severity: str | None = None,
    title: str | None = None,
    summary: str | None = None,
    due_date: str | None = Query(
        None, description="ISO date (YYYY-MM-DD), empty to clear, omitted to leave unchanged"
    ),
    resolution: str | None = Query(
        None, description="Close-out summary, empty to clear, omitted to leave unchanged"
    ),
    reviewed_fingerprint: str | None = Query(None, pattern="^[a-f0-9]{64}$"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update case status, severity, title, summary, or close-out resolution."""
    case = (await db.execute(
        _visible_cases(case_id, current_user).with_for_update()
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    is_editor = case.user_id == current_user.id or case.assigned_to_id == current_user.id
    if not is_editor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Watchers have read-only access to this case",
        )

    if case.user_id != current_user.id and any(
        value is not None for value in (severity, title, summary, due_date, resolution)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Assignees can update the status only; the case owner edits the details",
        )

    if reviewed_fingerprint is not None:
        if status_update not in {"resolved", "closed", "false_positive"} or any(
            value is not None for value in (severity, title, summary, due_date)
        ):
            raise HTTPException(status_code=422, detail=(
                "A reviewed close-out changes only status and optional resolution"))
        from backend.services.case_close_review import closeout_review

        preview = await closeout_review(db, case, current_user.id, status_update, lock=True)
        if case.status == status_update or not secrets.compare_digest(
            reviewed_fingerprint, preview["reviewed_fingerprint"]
        ):
            raise HTTPException(status_code=409, detail=(
                "The case or remaining work changed. Refresh and review close-out again."))

    old_severity = case.severity
    old_due_date = case.due_date
    old_status = case.status

    if status_update:
        done_statuses = ("resolved", "closed", "false_positive")
        was_done = case.status in done_statuses
        will_be_done = status_update in done_statuses
        case.status = status_update
        if will_be_done and not was_done:
            case.closed_at = datetime.now(UTC)
        elif was_done and not will_be_done:
            case.closed_at = None
    if severity:
        case.severity = severity
    if title is not None:
        stripped_title = title.strip()
        if not stripped_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        case.title = stripped_title
    if summary is not None:
        case.summary = summary.strip() or None
    if resolution is not None:
        case.resolution = resolution.strip() or None
    if due_date is not None:
        if due_date == "":
            case.due_date = None
        else:
            try:
                case.due_date = date.fromisoformat(due_date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="due_date must be an ISO date (YYYY-MM-DD)",
                ) from None
        # A moved or cleared due date re-arms the SLA breach notification.
        case.sla_breach_notified_at = None
        case.sla_due_soon_notified_at = None

    # Keep the assignee in the loop when the owner changes severity or due date.
    changes: list[str] = []
    if severity and case.severity != old_severity:
        changes.append(f"severity {old_severity or 'none'} -> {case.severity}")
    if due_date is not None and case.due_date != old_due_date:
        old_label = old_due_date.isoformat() if old_due_date else "none"
        new_label = case.due_date.isoformat() if case.due_date else "cleared"
        changes.append(f"due date {old_label} -> {new_label}")

    # Watchers follow every tracked change, including status transitions.
    watcher_changes = list(changes)
    if status_update and case.status != old_status:
        watcher_changes.append(f"status {old_status} -> {case.status}")

    # One notification per recipient with the fullest change list that
    # applies to them: the assignee hears about severity/due date edits,
    # watchers hear about those plus status changes.
    recipients: dict[int, list[str]] = {}
    assignee_id = case.assigned_to_id
    if changes and assignee_id is not None and assignee_id != current_user.id:
        recipients[assignee_id] = list(changes)
    if watcher_changes:
        watcher_ids = (await db.execute(
            select(CaseWatcher.user_id).where(CaseWatcher.case_id == case.id)
        )).scalars().all()
        for watcher_id in watcher_ids:
            if watcher_id != current_user.id:
                recipients[watcher_id] = list(watcher_changes)

    for recipient_id, change_list in recipients.items():
        db.add(Notification(
            user_id=recipient_id,
            kind="case_updated",
            title=f"Case #{case.id} updated",
            body=f"{'; '.join(change_list)} - {case.title}",
            link=f"/app/cases/{case.id}",
        ))

    await db.commit()

    for recipient_id, change_list in recipients.items():
        recipient = (await db.execute(
            select(User).where(User.id == recipient_id)
        )).scalar_one_or_none()
        if recipient is not None:
            await notify_investigation_event(
                recipient,
                kind="case_updated",
                severity=case.severity,
                title=f"Case #{case.id} updated",
                body=(
                    f"{current_user.email} updated an investigation you "
                    f"follow: {case.title}. Changes: {'; '.join(change_list)}."
                ),
                link_path=f"/app/cases/{case.id}",
            )
    return {"success": True, "message": "Case updated", **({"data": {
        "case_id": case.id, "status": case.status, "resolution": case.resolution,
        "closed_at": case.closed_at, "reviewed_fingerprint": reviewed_fingerprint,
    }} if reviewed_fingerprint is not None else {})}


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a case with its timeline, alert/event links and response plans."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    add_audit_log(
        db,
        user_id=current_user.id,
        action="case_deleted",
        target_type="case",
        target_id=case.id,
        detail=f"Case '{case.title}' deleted",
    )
    plan_ids = select(ResponsePlan.id).where(ResponsePlan.case_id == case_id).scalar_subquery()
    await db.execute(delete(ApprovalRequest).where(ApprovalRequest.plan_id.in_(plan_ids)))
    await db.execute(delete(ResponsePlan).where(ResponsePlan.case_id == case_id))
    await db.execute(delete(CaseAlert).where(CaseAlert.case_id == case_id))
    await db.execute(delete(CaseEvent).where(CaseEvent.case_id == case_id))
    await db.execute(delete(CaseTimeline).where(CaseTimeline.case_id == case_id))
    await db.delete(case)
    await db.commit()


@router.post("/{case_id}/assign")
async def assign_case(
    case_id: int,
    assignment: CaseAssign,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Assign a case to an organization member (null user_id unassigns)."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if assignment.user_id is not None:
        assignee = (await db.execute(
            select(User).where(User.id == assignment.user_id, User.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        wrong_org = (
            current_user.org_id is not None
            and assignee is not None
            and assignee.org_id != current_user.org_id
        )
        no_org = current_user.org_id is None and assignment.user_id != current_user.id
        if assignee is None or wrong_org or no_org:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assignee must be an active member of your organization"
            )

    case.assigned_to_id = assignment.user_id
    if assignment.user_id is not None and assignment.user_id != current_user.id:
        db.add(Notification(
            user_id=assignment.user_id,
            kind="case_assigned",
            title=f"Case #{case.id} assigned to you",
            body=case.title,
            link=f"/app/cases/{case.id}",
        ))
    await db.commit()
    if (
        assignment.user_id is not None
        and assignment.user_id != current_user.id
        and assignee is not None
    ):
        await notify_investigation_event(
            assignee,
            kind="case_assigned",
            severity=case.severity,
            title=f"Case #{case.id} assigned to you",
            body=(
                f"{current_user.email} assigned you an investigation: "
                f"{case.title}. Severity: {case.severity}."
            ),
            link_path=f"/app/cases/{case.id}",
        )
    assignee_email = None
    if case.assigned_to_id is not None:
        assignee_email = (await db.execute(
            select(User.email).where(User.id == case.assigned_to_id)
        )).scalar_one_or_none()
    return {
        "success": True,
        "assigned_to_id": case.assigned_to_id,
        "assigned_to_email": assignee_email,
    }


async def _get_watch_target(db: AsyncSession, case_id: int, current_user: User) -> Case:
    """Fetch a case the user can at least read, or 404."""
    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/{case_id}/watchers", response_model=list[CaseWatcherResponse])
async def list_case_watchers(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the members watching a case."""
    case = await _get_watch_target(db, case_id, current_user)
    rows = (await db.execute(
        select(CaseWatcher, User)
        .join(User, User.id == CaseWatcher.user_id)
        .where(CaseWatcher.case_id == case.id)
    )).all()
    return [
        CaseWatcherResponse(user_id=watcher.user_id, email=user.email, full_name=user.full_name)
        for watcher, user in rows
    ]


@router.post("/{case_id}/watch")
async def watch_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Watch a case you can see. Idempotent."""
    case = await _get_watch_target(db, case_id, current_user)
    existing = (await db.execute(
        select(CaseWatcher).where(
            CaseWatcher.case_id == case.id, CaseWatcher.user_id == current_user.id
        )
    )).scalar_one_or_none()
    if existing is None:
        db.add(CaseWatcher(case_id=case.id, user_id=current_user.id))
        await db.commit()
    return {"success": True, "watching": True}


@router.delete("/{case_id}/watch")
async def unwatch_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Stop watching a case. Idempotent."""
    case = await _get_watch_target(db, case_id, current_user)
    existing = (await db.execute(
        select(CaseWatcher).where(
            CaseWatcher.case_id == case.id, CaseWatcher.user_id == current_user.id
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    return {"success": True, "watching": False}


@router.post("/{case_id}/watchers", response_model=list[CaseWatcherResponse])
async def add_case_watcher(
    case_id: int,
    payload: CaseWatcherAdd,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Add an organization member as a watcher (owner only). Idempotent."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if payload.user_id != current_user.id:
        member = (await db.execute(
            select(User).where(User.id == payload.user_id, User.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        wrong_org = (
            current_user.org_id is not None
            and member is not None
            and member.org_id != current_user.org_id
        )
        no_org = current_user.org_id is None and payload.user_id != current_user.id
        if member is None or wrong_org or no_org:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Watcher must be an active member of your organization"
            )

    existing = (await db.execute(
        select(CaseWatcher).where(
            CaseWatcher.case_id == case.id, CaseWatcher.user_id == payload.user_id
        )
    )).scalar_one_or_none()
    if existing is None:
        db.add(CaseWatcher(case_id=case.id, user_id=payload.user_id))
        if payload.user_id != current_user.id:
            db.add(Notification(
                user_id=payload.user_id,
                kind="case_watching",
                title=f"You are now watching case #{case.id}",
                body=case.title,
                link=f"/app/cases/{case.id}",
            ))
        await db.commit()

    rows = (await db.execute(
        select(CaseWatcher, User)
        .join(User, User.id == CaseWatcher.user_id)
        .where(CaseWatcher.case_id == case.id)
    )).all()
    return [
        CaseWatcherResponse(user_id=watcher.user_id, email=user.email, full_name=user.full_name)
        for watcher, user in rows
    ]


@router.delete("/{case_id}/watchers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_case_watcher(
    case_id: int,
    user_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove a watcher: the owner can remove anyone, members remove themselves."""
    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if current_user.id != case.user_id and user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the case owner can remove other watchers",
        )
    existing = (await db.execute(
        select(CaseWatcher).where(
            CaseWatcher.case_id == case.id, CaseWatcher.user_id == user_id
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()


@router.post("/pipeline")
async def run_agent_pipeline(
    hours_back: int = Query(24, ge=1, le=168),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Run full agent pipeline: Detect → Triage → Cases."""
    from backend.services.agents.orchestrator import run_pipeline
    result = await run_pipeline(db=db, user_id=current_user.id, hours_back=hours_back)
    return {"success": True, "data": result}


@router.post("/auto-triage")
async def auto_triage(
    hours_back: int = Query(24, ge=1, le=168),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Run the AI triage agent on recent unprocessed alerts and events."""
    from backend.services.agents.triage import TriageAgent

    before_count = (await db.execute(
        select(func.count(Case.id)).where(Case.user_id == current_user.id)
    )).scalar_one()
    agent = TriageAgent(db=db, user_id=current_user.id)
    await agent.execute(hours_back=hours_back)
    after_count = (await db.execute(
        select(func.count(Case.id)).where(Case.user_id == current_user.id)
    )).scalar_one()
    cases_created = max(0, after_count - before_count)

    return {
        "success": True,
        "data": {
            "cases_created": cases_created,
            "summary": f"Created {cases_created} cases from recent alerts and events",
        },
    }


@router.get("/{case_id}/evidence-candidates")
async def list_case_evidence_candidates(
    case_id: int,
    kind: Literal["alert", "event"],
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    query: str = Query("", max_length=200),
    severity: Literal["all", "critical", "high", "medium", "low", "info"] = "all",
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Only the case owner can choose from their unlinked owned evidence records."""
    case = (await db.execute(select(Case).where(
        Case.id == case_id, Case.user_id == current_user.id))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    from backend.services.case_evidence_candidates import evidence_candidates

    return await evidence_candidates(db, current_user.id, case_id, kind=kind, page=page, size=size,
                                     query=query, severity=severity)


@router.get("/{case_id}/alerts")
async def get_case_alerts(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get alerts linked to a case."""
    from backend.models.alert import Alert

    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(Alert)
        .join(CaseAlert, CaseAlert.alert_id == Alert.id)
        .where(CaseAlert.case_id == case_id, Alert.user_id == case.user_id).distinct()
    )
    alerts = result.scalars().all()
    return [a.to_dict() for a in alerts]


async def _owned_evidence_destination(db: AsyncSession, case_id: int, user_id: int) -> Case:
    # Row locking serializes evidence decisions on PostgreSQL; SQLite needs its writer lock.
    # Preserve updated_at explicitly so a repeated no-op does not change case metadata.
    if db.bind.dialect.name == 'sqlite':
        await db.execute(update(Case).where(Case.id == case_id, Case.user_id == user_id)
                         .values(id=Case.id, updated_at=Case.updated_at))
    case = (await db.execute(select(Case).where(Case.id == case_id, Case.user_id == user_id)
                             .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.post("/{case_id}/alerts/{alert_id}")
async def link_alert_to_case(
    case_id: int,
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Link an alert to a case manually. Idempotent: re-linking is a no-op."""
    from backend.models.alert import Alert

    case = await _owned_evidence_destination(db, case_id, current_user.id)

    alert = (await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
    )).scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    existing = (await db.execute(
        select(CaseAlert).where(
            CaseAlert.case_id == case_id, CaseAlert.alert_id == alert_id
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return {"success": True, "data": {"linked": False, "message": "Alert already linked to this case"}}

    db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="alert",
        content=f"Alert linked manually by {current_user.email}: {alert.title}",
        source="human",
    ))
    if _severity_rank(alert.severity) > _severity_rank(case.severity):
        case.severity = alert.severity
        db.add(CaseTimeline(
            case_id=case.id,
            entry_type="action",
            content=f"Severity raised to {alert.severity} after linking alert #{alert.id}: {alert.title}",
            source="system",
        ))
    await db.commit()
    return {"success": True, "data": {"linked": True}}




@router.delete("/{case_id}/alerts/{alert_id}")
async def unlink_alert_from_case(
    case_id: int,
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove an alert link from a case. Idempotent: unlinking twice is a no-op."""
    case = await _owned_evidence_destination(db, case_id, current_user.id)

    link = (await db.execute(
        select(CaseAlert).where(
            CaseAlert.case_id == case_id, CaseAlert.alert_id == alert_id
        ).limit(1)
    )).scalar_one_or_none()
    if link is None:
        return {"success": True, "data": {"unlinked": False, "message": "Alert is not linked to this case"}}

    await db.execute(delete(CaseAlert).where(CaseAlert.case_id == case_id, CaseAlert.alert_id == alert_id))
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="alert",
        content=f"Alert #{alert_id} unlinked by {current_user.email}.",
        source="human",
    ))
    await db.commit()
    return {"success": True, "data": {"unlinked": True}}

@router.get("/{case_id}/events")
async def get_case_events(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get security events linked to a case."""
    from backend.models.security_event import SecurityEvent

    case = (await db.execute(
        _visible_cases(case_id, current_user)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(SecurityEvent)
        .join(CaseEvent, CaseEvent.event_id == SecurityEvent.id)
        .where(CaseEvent.case_id == case_id, SecurityEvent.user_id == case.user_id).distinct()
        .order_by(SecurityEvent.timestamp)
    )
    events = result.scalars().all()
    return [{"id": e.id, "timestamp": e.timestamp.isoformat(), "event_type": e.event_type,
             "severity": e.severity, "source_ip": e.source_ip, "dest_ip": e.dest_ip,
             "signature": e.signature, "category": e.category} for e in events]


@router.post("/{case_id}/events/{event_id}")
async def link_event_to_case(
    case_id: int,
    event_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Link a security event to a case manually. Idempotent: re-linking is a no-op."""
    from backend.models.security_event import SecurityEvent

    case = await _owned_evidence_destination(db, case_id, current_user.id)

    event = (await db.execute(
        select(SecurityEvent).where(SecurityEvent.id == event_id, SecurityEvent.user_id == current_user.id)
    )).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    existing = (await db.execute(
        select(CaseEvent).where(
            CaseEvent.case_id == case_id, CaseEvent.event_id == event_id
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return {"success": True, "data": {"linked": False, "message": "Event already linked to this case"}}

    db.add(CaseEvent(case_id=case.id, event_id=event.id))
    event.processed = "in_case"
    db.add(event)
    label = event.signature or f"{event.event_type} event"
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="event",
        content=f"Event linked manually by {current_user.email}: {label}",
        source="human",
    ))
    await db.commit()
    return {"success": True, "data": {"linked": True}}





@router.delete("/{case_id}/events/{event_id}")
async def unlink_event_from_case(
    case_id: int,
    event_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove an event link from a case. Idempotent: unlinking twice is a no-op."""
    case = await _owned_evidence_destination(db, case_id, current_user.id)

    link = (await db.execute(
        select(CaseEvent).where(
            CaseEvent.case_id == case_id, CaseEvent.event_id == event_id
        ).limit(1)
    )).scalar_one_or_none()
    if link is None:
        return {"success": True, "data": {"unlinked": False, "message": "Event is not linked to this case"}}

    await db.execute(delete(CaseEvent).where(CaseEvent.case_id == case_id, CaseEvent.event_id == event_id))
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="event",
        content=f"Event #{event_id} unlinked by {current_user.email}.",
        source="human",
    ))
    await db.commit()
    return {"success": True, "data": {"unlinked": True}}

@router.get("/{case_id}/similar")
async def get_similar_cases(
    case_id: int,
    max_results: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Find cases similar to a given case."""
    from backend.services.semantic_search import find_similar_cases
    results = await find_similar_cases(
        db=db, user_id=current_user.id, target_case_id=case_id, max_results=max_results,
    )
    return {"success": True, "data": results}


@router.get("/{case_id}/blast-radius")
async def get_case_blast_radius(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get blast radius graph for a case."""
    from backend.services.semantic_search import get_blast_radius
    result = await get_blast_radius(db=db, user_id=current_user.id, case_id=case_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return {"success": True, "data": result}


# --- Agent Ledger Endpoints ---

@router.get("/agents/runs", response_model=list[AgentRunResponse])
async def list_agent_runs(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all agent runs for the current user."""
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.user_id == current_user.id)
        .order_by(AgentRun.started_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.get("/agents/run-library")
async def browse_agent_runs(
    query: str = Query("", max_length=200), agent_type: str = Query("", max_length=100),
    run_status: str = Query("", max_length=100), model: str = Query("", max_length=200),
    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Browse all current owned ledger runs without loading step bodies or errors."""
    scope = [AgentRun.user_id == current_user.id]
    filtered = list(scope)
    if query.strip():
        needle = query.strip().lower()
        filtered.append(or_(*[func.lower(func.coalesce(cast(column, String), "")).contains(
            needle, autoescape=True) for column in (
                AgentRun.id, AgentRun.agent_type, AgentRun.status, AgentRun.model_used, AgentRun.result_summary,
            )]))
    for value, column in ((agent_type, AgentRun.agent_type), (run_status, AgentRun.status),
                          (model, AgentRun.model_used)):
        if value:
            filtered.append(column == value)
    total = (await db.execute(select(func.count(AgentRun.id)).where(*filtered))).scalar_one()
    records = (await db.execute(select(AgentRun).where(*filtered).order_by(
        AgentRun.started_at.desc(), AgentRun.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    options = {}
    for key, column in (("agent_types", AgentRun.agent_type), ("statuses", AgentRun.status),
                        ("models", AgentRun.model_used)):
        values = (await db.execute(select(column).where(*scope).distinct().order_by(column))).scalars().all()
        options[key] = [value for value in values if value]
    return {"query": query.strip(), "agent_type": agent_type, "run_status": run_status, "model": model,
            "page": page, "size": size, "total": total, "retrieved_at": datetime.now(UTC), **options,
            "records": [AgentRunResponse.model_validate(row) for row in records]}


@router.get("/agents/runs/{run_id}", response_model=AgentRunDetailResponse)
async def get_agent_run(
    run_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Inspect one run and its recorded steps, restricted to its owner."""
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.id == run_id, AgentRun.user_id == current_user.id)
        .options(selectinload(AgentRun.steps))
    )
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return run
