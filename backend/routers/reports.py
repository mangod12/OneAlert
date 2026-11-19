"""Posture report: on-demand security posture summary over a trailing window."""

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, select
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


def _mean_delta_seconds(rows: list) -> float | None:
    deltas = []
    for created_at, ended_at in rows:
        if created_at is None or ended_at is None:
            continue
        start_dt = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
        end_dt = ended_at.replace(tzinfo=None) if ended_at.tzinfo else ended_at
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


def _sla_bucket() -> dict:
    return {
        "due": 0,
        "met": 0,
        "breached": 0,
        "by_severity": {
            sev: {"due": 0, "met": 0, "breached": 0}
            for sev in ("critical", "high", "medium", "low")
        },
    }


def _sla_tally(bucket: dict, severity: str, met: bool) -> None:
    bucket["due"] += 1
    bucket["met" if met else "breached"] += 1
    sev = severity if severity in bucket["by_severity"] else "low"
    entry = bucket["by_severity"][sev]
    entry["due"] += 1
    entry["met" if met else "breached"] += 1


def _sla_finish(bucket: dict, upcoming: int) -> dict:
    decided = bucket["met"] + bucket["breached"]
    attainment = round(bucket["met"] / decided * 100, 1) if decided else None
    return {
        "due": bucket["due"],
        "met": bucket["met"],
        "breached": bucket["breached"],
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
        .where(Alert.user_id == current_user.id)
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
        and (created_at.replace(tzinfo=None) if created_at.tzinfo else created_at) >= start
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
    upcoming. Investigation completion uses updated_at as a proxy, since
    cases carry no resolved_at timestamp.
    """
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days)

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
        resolved_on = _as_date(alert.resolved_at)
        met = resolved_on is not None and resolved_on <= alert.due_date
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
        completed_on = (
            _as_date(case.updated_at) if case.status in _DONE_CASE_STATUSES else None
        )
        met = completed_on is not None and completed_on <= case.due_date
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
