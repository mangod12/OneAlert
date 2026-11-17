"""Cases router — investigation cases created by AI triage agent."""


from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case as sql_case
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from backend.database.db import get_async_db
from backend.models.case import (
    AgentRun,
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
    CaseTimeline,
    TimelineEntryResponse,
)
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/", response_model=CaseListResponse)
async def list_cases(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    severity: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    assigned: str | None = Query(
        None, pattern="^(me|unassigned)$", description="Filter by assignment: 'me' or 'unassigned'"
    ),
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|severity_desc|severity_asc)$",
        description="Sort order"
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List investigation cases with pagination and filters."""
    skip = (page - 1) * size

    query = select(Case).options(joinedload(Case.assignee)).where(Case.user_id == current_user.id)
    count_q = select(func.count(Case.id)).where(Case.user_id == current_user.id)

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
    }
    query = query.order_by(*order_columns[sort]).offset(skip).limit(size)
    cases = (await db.execute(query)).scalars().all()

    # Enrich with counts
    case_responses = []
    for case in cases:
        alert_count = (await db.execute(
            select(func.count(CaseAlert.id)).where(CaseAlert.case_id == case.id)
        )).scalar_one()
        event_count = (await db.execute(
            select(func.count(CaseEvent.id)).where(CaseEvent.case_id == case.id)
        )).scalar_one()

        resp = CaseResponse.model_validate(case)
        resp.alert_count = alert_count
        resp.event_count = event_count
        resp.assigned_to_email = case.assignee.email if case.assignee else None
        case_responses.append(resp)

    return CaseListResponse(cases=case_responses, total=total, page=page, size=size)


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
    )
    db.add(case)
    await db.flush()
    db.add(CaseTimeline(
        case_id=case.id,
        entry_type="note",
        content=f"Investigation opened manually by {current_user.email}.",
        source="human",
    ))
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


@router.get("/{case_id}", response_model=CaseDetailResponse)
async def get_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get case detail with timeline."""
    case = (await db.execute(
        select(Case).options(joinedload(Case.assignee)).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # Get timeline
    timeline = (await db.execute(
        select(CaseTimeline)
        .where(CaseTimeline.case_id == case_id)
        .order_by(CaseTimeline.timestamp)
    )).scalars().all()

    # Get counts
    alert_count = (await db.execute(
        select(func.count(CaseAlert.id)).where(CaseAlert.case_id == case_id)
    )).scalar_one()
    event_count = (await db.execute(
        select(func.count(CaseEvent.id)).where(CaseEvent.case_id == case_id)
    )).scalar_one()

    resp = CaseDetailResponse.model_validate(case)
    resp.alert_count = alert_count
    resp.event_count = event_count
    resp.assigned_to_email = case.assignee.email if case.assignee else None
    resp.timeline = [TimelineEntryResponse.model_validate(t) for t in timeline]
    return resp


@router.post("/{case_id}/notes", response_model=TimelineEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_case_note(
    case_id: int,
    note: CaseNoteCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Add an investigator note to the case timeline."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
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
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
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


@router.patch("/{case_id}")
async def update_case(
    case_id: int,
    status_update: str | None = None,
    severity: str | None = None,
    title: str | None = None,
    summary: str | None = None,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update case status, severity, title, or summary."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if status_update:
        case.status = status_update
    if severity:
        case.severity = severity
    if title is not None:
        stripped_title = title.strip()
        if not stripped_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        case.title = stripped_title
    if summary is not None:
        case.summary = summary.strip() or None

    await db.commit()
    return {"success": True, "message": "Case updated"}


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
    await db.commit()
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


@router.get("/{case_id}/alerts")
async def get_case_alerts(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get alerts linked to a case."""
    from backend.models.alert import Alert

    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(Alert)
        .join(CaseAlert, CaseAlert.alert_id == Alert.id)
        .where(CaseAlert.case_id == case_id)
    )
    alerts = result.scalars().all()
    return [a.to_dict() for a in alerts]


@router.post("/{case_id}/alerts/{alert_id}")
async def link_alert_to_case(
    case_id: int,
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Link an alert to a case manually. Idempotent: re-linking is a no-op."""
    from backend.models.alert import Alert

    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    alert = (await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
    )).scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    existing = (await db.execute(
        select(CaseAlert).where(
            CaseAlert.case_id == case_id, CaseAlert.alert_id == alert_id
        )
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
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    link = (await db.execute(
        select(CaseAlert).where(
            CaseAlert.case_id == case_id, CaseAlert.alert_id == alert_id
        )
    )).scalar_one_or_none()
    if link is None:
        return {"success": True, "data": {"unlinked": False, "message": "Alert is not linked to this case"}}

    await db.delete(link)
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
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(SecurityEvent)
        .join(CaseEvent, CaseEvent.event_id == SecurityEvent.id)
        .where(CaseEvent.case_id == case_id)
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

    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    event = (await db.execute(
        select(SecurityEvent).where(SecurityEvent.id == event_id, SecurityEvent.user_id == current_user.id)
    )).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    existing = (await db.execute(
        select(CaseEvent).where(
            CaseEvent.case_id == case_id, CaseEvent.event_id == event_id
        )
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
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    link = (await db.execute(
        select(CaseEvent).where(
            CaseEvent.case_id == case_id, CaseEvent.event_id == event_id
        )
    )).scalar_one_or_none()
    if link is None:
        return {"success": True, "data": {"unlinked": False, "message": "Event is not linked to this case"}}

    await db.delete(link)
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
