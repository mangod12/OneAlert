"""Posture report: on-demand security posture summary over a trailing window."""

from datetime import UTC, datetime, timedelta

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
    cases_in_progress = sum(1 for status, _ in case_rows if status == "in_progress")
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
