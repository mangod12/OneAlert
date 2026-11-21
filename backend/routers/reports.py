"""Posture report: on-demand security posture summary over a trailing window."""

from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy import case as sql_case
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.user import User

router = APIRouter()

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_ACTIVE_ALERT_STATUSES = ("pending", "sent", "acknowledged")
_DONE_CASE_STATUSES = ("resolved", "closed", "false_positive")


def _severity_value(alert: Alert) -> str:
    severity = alert.severity
    return severity.value if hasattr(severity, "value") else str(severity)


def _status_value(alert: Alert) -> str:
    status = alert.status
    return status.value if hasattr(status, "value") else str(status)


def _naive_utc(value: datetime) -> datetime:
    """Normalize an instant before arithmetic; legacy naive timestamps are stored UTC."""
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo is not None else value


def _mean_delta_seconds(rows: list) -> float | None:
    deltas = []
    for created_at, ended_at in rows:
        if created_at is None or ended_at is None:
            continue
        start_dt = _naive_utc(created_at)
        end_dt = _naive_utc(ended_at)
        delta = (end_dt - start_dt).total_seconds()
        if delta >= 0:
            deltas.append(delta)
    if not deltas:
        return None
    return sum(deltas) / len(deltas)


def _as_date(value) -> date | None:
    """Date part of a stored timestamp, tolerant of naive and aware values."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _sla_completion(record, kind: str) -> tuple[bool | None, date | None]:
    """Use the same completion evidence for summary counts and record review."""
    done = _status_value(record) == "resolved" if kind == "alerts" else record.status in _DONE_CASE_STATUSES
    completed_on = _as_date(record.resolved_at if kind == "alerts" else record.closed_at)
    if not done:
        return False, completed_on
    return (completed_on <= record.due_date if completed_on else None), completed_on


def _sla_bucket() -> dict:
    return {
        "due": 0,
        "met": 0,
        "breached": 0,
        "unknown": 0,
        "by_severity": {
            sev: {"due": 0, "met": 0, "breached": 0, "unknown": 0}
            for sev in ("critical", "high", "medium", "low")
        },
    }


def _sla_tally(bucket: dict, severity: str, met: bool | None) -> None:
    bucket["due"] += 1
    outcome = "unknown" if met is None else "met" if met else "breached"
    bucket[outcome] += 1
    sev = severity if severity in bucket["by_severity"] else "low"
    entry = bucket["by_severity"][sev]
    entry["due"] += 1
    entry[outcome] += 1


def _sla_finish(bucket: dict, upcoming: int) -> dict:
    decided = bucket["met"] + bucket["breached"]
    attainment = round(bucket["met"] / decided * 100, 1) if decided else None
    return {
        "due": bucket["due"],
        "met": bucket["met"],
        "breached": bucket["breached"],
        "unknown": bucket["unknown"],
        "upcoming": upcoming,
        "attainment_pct": attainment,
        "by_severity": bucket["by_severity"],
    }


@router.get("/posture")
async def get_posture_report(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Security posture summary over the trailing `days`-day window."""
    # naive UTC, matching stored timestamps
    start = (datetime.now(UTC) - timedelta(days=days)).replace(tzinfo=None)

    # Alerts opened in the window, grouped by severity.
    opened_result = await db.execute(
        select(Alert).where(
            and_(Alert.user_id == current_user.id, Alert.created_at >= start)
        )
    )
    opened_alerts = opened_result.scalars().all()
    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for alert in opened_alerts:
        sev = _severity_value(alert)
        if sev in by_severity:
            by_severity[sev] += 1

    # Response metrics for the window.
    ack_result = await db.execute(
        select(Alert.created_at, Alert.acknowledged_at).where(
            and_(
                Alert.user_id == current_user.id,
                Alert.acknowledged_at.is_not(None),
                Alert.acknowledged_at >= start,
            )
        )
    )
    ack_rows = ack_result.all()
    res_result = await db.execute(
        select(Alert.created_at, Alert.resolved_at).where(
            and_(
                Alert.user_id == current_user.id,
                Alert.resolved_at.is_not(None),
                Alert.resolved_at >= start,
            )
        )
    )
    res_rows = res_result.all()

    # Currently active alerts per asset -> active incidents (2+ active alerts).
    active_result = await db.execute(
        select(Alert, Asset)
        .join(Asset, Asset.id == Alert.asset_id)
        .where(Alert.user_id == current_user.id, Asset.user_id == current_user.id)
    )
    by_asset: dict[int, dict] = {}
    for alert, asset in active_result.all():
        if _status_value(alert) not in _ACTIVE_ALERT_STATUSES:
            continue
        entry = by_asset.setdefault(
            asset.id, {"asset_id": asset.id, "asset_name": asset.name, "alerts": []}
        )
        entry["alerts"].append(alert)

    incidents = []
    for entry in by_asset.values():
        alerts = entry["alerts"]
        if len(alerts) < 2:
            continue
        max_sev = max(
            (_severity_value(a) for a in alerts),
            key=lambda s: _SEVERITY_RANK.get(s, -1),
        )
        incidents.append(
            {
                "asset_id": entry["asset_id"],
                "asset_name": entry["asset_name"],
                "alert_count": len(alerts),
                "max_severity": max_sev,
            }
        )
    incidents.sort(
        key=lambda i: (_SEVERITY_RANK.get(i["max_severity"], -1), i["alert_count"]),
        reverse=True,
    )

    # Investigations: current status counts plus opened in the window.
    case_rows = (
        await db.execute(select(Case.status, Case.created_at).where(Case.user_id == current_user.id))
    ).all()
    cases_open = sum(1 for status, _ in case_rows if status == "open")
    cases_in_progress = sum(1 for status, _ in case_rows if status == "investigating")
    cases_done = sum(1 for status, _ in case_rows if status in _DONE_CASE_STATUSES)
    cases_opened = sum(
        1
        for _, created_at in case_rows
        if created_at is not None
        and _naive_utc(created_at) >= start
    )

    return {
        "success": True,
        "days": days,
        "generated_at": datetime.now(UTC).isoformat(),
        "alerts": {
            "opened": len(opened_alerts),
            "acknowledged": len(ack_rows),
            "resolved": len(res_rows),
            "by_severity": by_severity,
            "mtta_seconds": _mean_delta_seconds(ack_rows),
            "mttr_seconds": _mean_delta_seconds(res_rows),
        },
        "incidents": {
            "active": len(incidents),
            "critical": sum(1 for i in incidents if i["max_severity"] == "critical"),
            "top_assets": incidents[:5],
        },
        "cases": {
            "open": cases_open,
            "in_progress": cases_in_progress,
            "closed": cases_done,
            "opened": cases_opened,
        },
    }


@router.get("/sla")
async def get_sla_compliance_report(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """SLA compliance over the trailing `days`-day window.

    The scored cohort is every alert and investigation whose due date fell
    inside the window: an item met its SLA when it was resolved or closed on
    or before its due date, and breached it otherwise (resolved late or
    still unresolved). Items due after today are reported separately as
    upcoming. Completion uses recorded resolved_at/closed_at, never the last
    edit timestamp. Done items without a completion timestamp have unknown
    timing and are excluded from the attainment percentage denominator.
    """
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)

    # Alerts with a triage due date in the window.
    alert_rows = (
        await db.execute(
            select(Alert).where(
                and_(
                    Alert.user_id == current_user.id,
                    Alert.due_date.is_not(None),
                    Alert.due_date >= start,
                    Alert.due_date <= today,
                )
            )
        )
    ).scalars().all()
    alerts = _sla_bucket()
    for alert in alert_rows:
        met, _ = _sla_completion(alert, "alerts")
        _sla_tally(alerts, _severity_value(alert), met)

    alert_upcoming = (
        await db.execute(
            select(Alert.id).where(
                and_(
                    Alert.user_id == current_user.id,
                    Alert.due_date.is_not(None),
                    Alert.due_date > today,
                    Alert.status.in_(_ACTIVE_ALERT_STATUSES),
                )
            )
        )
    ).all()

    # Investigations with an SLA due date in the window.
    case_rows = (
        await db.execute(
            select(Case).where(
                and_(
                    Case.user_id == current_user.id,
                    Case.due_date.is_not(None),
                    Case.due_date >= start,
                    Case.due_date <= today,
                )
            )
        )
    ).scalars().all()
    cases = _sla_bucket()
    for case in case_rows:
        met, _ = _sla_completion(case, "cases")
        _sla_tally(cases, case.severity or "medium", met)

    case_upcoming = (
        await db.execute(
            select(Case.id).where(
                and_(
                    Case.user_id == current_user.id,
                    Case.due_date.is_not(None),
                    Case.due_date > today,
                    Case.status.notin_(_DONE_CASE_STATUSES),
                )
            )
        )
    ).all()

    return {
        "success": True,
        "days": days,
        "generated_at": datetime.now(UTC).isoformat(),
        "alerts": _sla_finish(alerts, len(alert_upcoming)),
        "cases": _sla_finish(cases, len(case_upcoming)),
    }


@router.get("/sla/records")
async def get_sla_records(
    kind: Literal["alerts", "cases"] = "alerts",
    days: int = Query(30, ge=1, le=90),
    outcome: Literal["all", "met", "breached", "unknown"] = "all",
    query: str = Query("", max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read the owner-scoped records behind the SLA summary, without editing them."""
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)
    model = Alert if kind == "alerts" else Case
    done = model.status == "resolved" if kind == "alerts" else model.status.in_(_DONE_CASE_STATUSES)
    done = func.coalesce(done, False)
    completion = model.resolved_at if kind == "alerts" else model.closed_at
    result_expression = sql_case(
        (~done, "breached"),
        (completion.is_(None), "unknown"),
        (func.date(completion) <= model.due_date, "met"),
        else_="breached",
    )
    conditions = [model.user_id == current_user.id, model.due_date >= start, model.due_date <= today]
    if outcome != "all":
        conditions.append(result_expression == outcome)
    needle = query.strip().lower()
    if needle:
        conditions.append(or_(
            func.lower(model.title).contains(needle, autoescape=True),
            func.lower(cast(model.status, String)).contains(needle, autoescape=True),
            cast(model.id, String).contains(needle, autoescape=True),
        ))
    total = (await db.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
    records = (await db.execute(
        select(model).where(*conditions).order_by(model.due_date, model.id).offset(offset).limit(limit)
    )).scalars().all()
    matched = []
    for record in records:
        met, completed_on = _sla_completion(record, kind)
        result = "unknown" if met is None else "met" if met else "breached"
        status = _status_value(record)
        done = status == "resolved" if kind == "alerts" else status in _DONE_CASE_STATUSES
        reason = (
            "Record is not currently resolved or closed. Any older completion time does not establish completion."
            if not done else "Completion time was not recorded; timing cannot be scored."
            if met is None else "Recorded completion was on or before the due date."
            if met else "Recorded completion was after the due date."
        )
        matched.append({
            "id": record.id, "title": record.title, "status": status,
            "severity": _severity_value(record), "due_date": record.due_date,
            "completed_on": completed_on, "outcome": result, "reason": reason,
        })
    return {
        "kind": kind, "days": days, "window_start": start, "window_end": today,
        "generated_at": datetime.now(UTC).isoformat(), "outcome": outcome,
        "query": query, "total": total, "offset": offset, "limit": limit,
        "records": matched,
    }


SLA_EVIDENCE_EXPORT_LIMIT = 1000


@router.get("/sla/records/export")
async def export_sla_evidence(
    kind: Literal["alerts", "cases"] = "alerts", days: int = Query(30, ge=1, le=90),
    outcome: Literal["all", "met", "breached", "unknown"] = "all", query: str = Query("", max_length=200),
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    """Complete bounded owner-scoped current SLA evidence, never a partial export."""
    result = await get_sla_records(kind=kind, days=days, outcome=outcome, query=query,
                                   offset=0, limit=SLA_EVIDENCE_EXPORT_LIMIT + 1, current_user=current_user, db=db)
    if result["total"] > SLA_EVIDENCE_EXPORT_LIMIT or len(result["records"]) > SLA_EVIDENCE_EXPORT_LIMIT:
        raise HTTPException(status_code=422, detail=f"More than {SLA_EVIDENCE_EXPORT_LIMIT} SLA records match. "
                            "Narrow the search, outcome or day window. No partial export was created.")
    if len(result["records"]) != result["total"]:
        raise HTTPException(status_code=409, detail="SLA records changed while loading. Retry the export. "
                            "No partial export was created.")
    return {**result, "format": "onealert-sla-evidence-v1", "complete": True,
            "scope": "Current owner-scoped records selected by UTC due date and the requested filters. "
                     "A new read, not a frozen copy of the displayed report or an audit history. "
                     "Unknown completion timing is not proof of meeting or breaching a deadline. "
                     "No external remediation is verified. Keep this file within an appropriate audience."}


@router.get("/team-workload")
async def get_team_workload_report(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Open assigned work per active organization member.

    Counts span the whole org (assignments cross alert/case owners), so the
    caller sees every member of their org, or just themselves when they have
    no org. Overdue means past the triage or SLA due date while still open.
    mtta_seconds/mttr_seconds are trailing-30-day mean acknowledge/resolve
    times for alerts assigned to the member.
    """
    today = datetime.now(UTC).date()

    if current_user.org_id is not None:
        members = (await db.execute(
            select(User).where(User.org_id == current_user.org_id, User.is_active == True)  # noqa: E712
        )).scalars().all()
    else:
        members = [current_user]
    member_ids = [m.id for m in members]

    alerts_open = dict((await db.execute(
        select(Alert.assigned_to_id, func.count())
        .where(Alert.assigned_to_id.in_(member_ids), Alert.status.in_(_ACTIVE_ALERT_STATUSES))
        .group_by(Alert.assigned_to_id)
    )).all()) if member_ids else {}
    alerts_overdue = dict((await db.execute(
        select(Alert.assigned_to_id, func.count())
        .where(
            Alert.assigned_to_id.in_(member_ids),
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
            Alert.due_date.is_not(None),
            Alert.due_date < today,
        )
        .group_by(Alert.assigned_to_id)
    )).all()) if member_ids else {}
    cases_open = dict((await db.execute(
        select(Case.assigned_to_id, func.count())
        .where(Case.assigned_to_id.in_(member_ids), Case.status.notin_(_DONE_CASE_STATUSES))
        .group_by(Case.assigned_to_id)
    )).all()) if member_ids else {}
    cases_overdue = dict((await db.execute(
        select(Case.assigned_to_id, func.count())
        .where(
            Case.assigned_to_id.in_(member_ids),
            Case.status.notin_(_DONE_CASE_STATUSES),
            Case.due_date.is_not(None),
            Case.due_date < today,
        )
        .group_by(Case.assigned_to_id)
    )).all()) if member_ids else {}
    window_start = datetime.now(UTC) - timedelta(days=30)
    ack_rows = (await db.execute(
        select(Alert.assigned_to_id, Alert.created_at, Alert.acknowledged_at)
        .where(
            Alert.assigned_to_id.in_(member_ids),
            Alert.acknowledged_at.is_not(None),
            Alert.acknowledged_at >= window_start,
        )
    )).all() if member_ids else []
    res_rows = (await db.execute(
        select(Alert.assigned_to_id, Alert.created_at, Alert.resolved_at)
        .where(
            Alert.assigned_to_id.in_(member_ids),
            Alert.resolved_at.is_not(None),
            Alert.resolved_at >= window_start,
        )
    )).all() if member_ids else []
    ack_by_member: dict[int, list] = {}
    for assignee_id, created_at, acked_at in ack_rows:
        ack_by_member.setdefault(assignee_id, []).append((created_at, acked_at))
    res_by_member: dict[int, list] = {}
    for assignee_id, created_at, resolved_at in res_rows:
        res_by_member.setdefault(assignee_id, []).append((created_at, resolved_at))

    from backend.models.case import CaseTask
    tasks_open = dict((await db.execute(
        select(CaseTask.assignee_id, func.count())
        .join(Case, Case.id == CaseTask.case_id)
        .where(
            CaseTask.assignee_id.in_(member_ids),
            CaseTask.done == False,  # noqa: E712
            Case.status.notin_(_DONE_CASE_STATUSES),
        )
        .group_by(CaseTask.assignee_id)
    )).all()) if member_ids else {}

    tasks_overdue = dict((await db.execute(
        select(CaseTask.assignee_id, func.count())
        .join(Case, Case.id == CaseTask.case_id)
        .where(
            CaseTask.assignee_id.in_(member_ids),
            CaseTask.done == False,  # noqa: E712
            CaseTask.due_date.is_not(None),
            CaseTask.due_date < today,
            Case.status.notin_(_DONE_CASE_STATUSES),
        )
        .group_by(CaseTask.assignee_id)
    )).all()) if member_ids else {}
    task_done_rows = (await db.execute(
        select(CaseTask.assignee_id, CaseTask.created_at, CaseTask.completed_at)
        .where(
            CaseTask.assignee_id.in_(member_ids),
            CaseTask.done == True,  # noqa: E712
            CaseTask.completed_at.is_not(None),
            CaseTask.completed_at >= window_start,
        )
    )).all() if member_ids else []
    task_done_by_member: dict[int, list] = {}
    for assignee_id, created_at, completed_at in task_done_rows:
        task_done_by_member.setdefault(assignee_id, []).append((created_at, completed_at))

    rows = [
        {
            "user_id": m.id,
            "email": m.email,
            "full_name": m.full_name,
            "alerts_open": alerts_open.get(m.id, 0),
            "alerts_overdue": alerts_overdue.get(m.id, 0),
            "cases_open": cases_open.get(m.id, 0),
            "cases_overdue": cases_overdue.get(m.id, 0),
            "tasks_open": tasks_open.get(m.id, 0),
            "tasks_overdue": tasks_overdue.get(m.id, 0),
            "mtta_seconds": _mean_delta_seconds(ack_by_member.get(m.id, [])),
            "mttr_seconds": _mean_delta_seconds(res_by_member.get(m.id, [])),
            "mtct_seconds": _mean_delta_seconds(task_done_by_member.get(m.id, [])),
        }
        for m in members
    ]
    rows.sort(
        key=lambda r: (r["alerts_open"] + r["cases_open"] + r["tasks_open"], r["email"]),
        reverse=True,
    )
    return {"success": True, "generated_at": datetime.now(UTC).isoformat(), "members": rows}


@router.get("/alert-trend")
async def get_alert_trend_report(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Daily opened vs resolved alert counts over the trailing `days`-day window.

    Days with no activity are included with zero counts so the chart has no
    gaps. Owned alerts only, matching the posture report.
    """
    today = datetime.now(UTC).date()
    # naive UTC, matching stored timestamps
    start_dt = datetime.combine(today - timedelta(days=days - 1), datetime.min.time())

    rows = (await db.execute(
        select(Alert.created_at, Alert.resolved_at).where(
            and_(
                Alert.user_id == current_user.id,
                or_(Alert.created_at >= start_dt, Alert.resolved_at >= start_dt),
            )
        )
    )).all()

    opened_by_day: dict[str, int] = {}
    resolved_by_day: dict[str, int] = {}
    for created_at, resolved_at in rows:
        if created_at is not None and created_at >= start_dt:
            key = created_at.date().isoformat()
            opened_by_day[key] = opened_by_day.get(key, 0) + 1
        if resolved_at is not None and resolved_at >= start_dt:
            key = resolved_at.date().isoformat()
            resolved_by_day[key] = resolved_by_day.get(key, 0) + 1

    series = []
    for offset in range(days):
        day = (today - timedelta(days=days - 1 - offset)).isoformat()
        series.append({
            "date": day,
            "opened": opened_by_day.get(day, 0),
            "resolved": resolved_by_day.get(day, 0),
        })
    return {"success": True, "days": days, "generated_at": datetime.now(UTC).isoformat(), "series": series}


@router.get('/posture/alert-records')
async def posture_alert_records(
    metric: Literal['opened', 'acknowledged', 'resolved'] = 'opened',
    days: int = Query(30, ge=1, le=90),
    query: str = Query('', max_length=200),
    offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_async_db),
):
    """Read the current owned source records behind one posture alert metric."""
    now = datetime.now(UTC)
    start = (now - timedelta(days=days)).replace(tzinfo=None)
    timestamp = {'opened': Alert.created_at, 'acknowledged': Alert.acknowledged_at,
                 'resolved': Alert.resolved_at}[metric]
    scope = [Alert.user_id == current_user.id, timestamp >= start]
    timings = (await db.execute(select(Alert.created_at, timestamp).where(*scope))).all()
    usable = []
    if metric != 'opened':
        for created, ended in timings:
            duration = _mean_delta_seconds([(created, ended)])
            if duration is not None:
                usable.append(duration)
    filtered = list(scope)
    text = query.strip()
    if text:
        escaped = text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        pattern = f'%{escaped}%'
        filtered.append(or_(Alert.title.ilike(pattern, escape='\\'),
                            Alert.status.ilike(pattern, escape='\\'),
                            Alert.severity.ilike(pattern, escape='\\'),
                            cast(Alert.id, String).ilike(pattern, escape='\\')))
    total = (await db.execute(select(func.count(Alert.id)).where(*filtered))).scalar_one()
    rows = (await db.execute(select(Alert).where(*filtered).order_by(timestamp.desc(), Alert.id.desc())
                            .offset(offset).limit(limit))).scalars().all()
    records = []
    for row in rows:
        ended = getattr(row, {'opened': 'created_at', 'acknowledged': 'acknowledged_at',
                              'resolved': 'resolved_at'}[metric])
        duration = None if metric == 'opened' else _mean_delta_seconds([(row.created_at, ended)])
        reason = ('Not a response-time metric.' if metric == 'opened' else
                  'Included in the mean response time.' if duration is not None else
                  'Excluded from the mean: missing or negative recorded elapsed time.')
        records.append({'id': row.id, 'title': row.title, 'severity': _severity_value(row),
                        'status': _status_value(row), 'created_at': row.created_at,
                        'metric_at': ended, 'duration_seconds': duration, 'timing_reason': reason})
    return {'metric': metric, 'days': days, 'query': query, 'offset': offset, 'limit': limit,
            'window_start': start.replace(tzinfo=UTC), 'generated_at': now, 'total': total,
            'source_count': len(timings),
            'timing_count': len(usable) if metric != 'opened' else None,
            'excluded_timing_count': len(timings) - len(usable) if metric != 'opened' else None,
            'mean_seconds': sum(usable) / len(usable) if usable else None, 'records': records}
