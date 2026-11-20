"""Incident correlation: groups active alerts on shared assets into incidents."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert
from backend.models.network_connection import NetworkConnection
from backend.models.user import User
from backend.services.audit import add_audit_log
from backend.services.sla import sla_due_date

router = APIRouter()

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_ACTIVE_STATUSES = ("pending", "sent", "acknowledged")


def _severity_value(alert: Alert) -> str:
    severity = alert.severity
    return severity.value if hasattr(severity, "value") else str(severity)


def _max_severity(alerts: list[Alert]) -> str:
    return max(
        (_severity_value(a) for a in alerts),
        key=lambda s: _SEVERITY_RANK.get(s, -1),
    )


def _alert_dict(alert: Alert) -> dict:
    status = alert.status
    return {
        "id": alert.id,
        "cve_id": alert.cve_id,
        "title": alert.title,
        "severity": _severity_value(alert),
        "status": status.value if hasattr(status, "value") else str(status),
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


async def _incident_context(
    db: AsyncSession, user_id: int, groups: dict[int, tuple[Asset, list[Alert]]]
):
    """Load topology counts and linked cases in at most two owner-scoped reads."""
    ips = {asset.last_known_ip for asset, _alerts in groups.values() if asset.last_known_ip}
    counts = {ip: 0 for ip in ips}
    if ips:
        rows = await db.execute(
            select(NetworkConnection.source_ip, NetworkConnection.target_ip).where(
                NetworkConnection.user_id == user_id,
                NetworkConnection.source_ip.in_(ips) | NetworkConnection.target_ip.in_(ips),
            )
        )
        for source, target in rows.all():
            for ip in {source, target} & ips:
                counts[ip] += 1
    cases_by_asset = {asset_id: [] for asset_id in groups}
    if groups:
        rows = await db.execute(
            select(Alert.asset_id, Case)
            .join(CaseAlert, CaseAlert.alert_id == Alert.id)
            .join(Case, CaseAlert.case_id == Case.id)
            .where(Alert.asset_id.in_(groups), Alert.user_id == user_id,
                   Alert.status.in_(_ACTIVE_STATUSES), Case.user_id == user_id)
            .distinct()
        )
        for asset_id, case in rows.all():
            cases_by_asset[asset_id].append({"id": case.id, "title": case.title, "status": case.status})
    return counts, cases_by_asset


async def _active_alerts_by_asset(
    db: AsyncSession, user_id: int
) -> dict[int, tuple[Asset, list[Alert]]]:
    rows = await db.execute(
        select(Alert, Asset)
        .join(Asset, Alert.asset_id == Asset.id)
        .where(Alert.user_id == user_id, Alert.status.in_(_ACTIVE_STATUSES))
    )
    groups: dict[int, tuple[Asset, list[Alert]]] = {}
    for alert, asset in rows.all():
        groups.setdefault(asset.id, (asset, []))[1].append(alert)
    return groups


@router.get("")
async def list_incidents(
    severity: str | None = Query(None, description="Minimum max-severity to include"),
    asset: str | None = Query(None, description="Case-insensitive asset name/vendor/product match"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Correlate active alerts into incidents: one per asset with 2+ active alerts.

    Incidents are computed on read, so they always reflect current alert state.
    `severity` keeps only incidents whose worst alert is at least that severe;
    `asset` keeps only incidents whose asset name, vendor, or product contains
    the text (case-insensitive).
    """
    min_rank = None
    if severity is not None:
        if severity not in _SEVERITY_RANK:
            raise HTTPException(status_code=422, detail=f"Unknown severity: {severity}")
        min_rank = _SEVERITY_RANK[severity]
    asset_term = asset.strip().lower() if asset else None

    groups = await _active_alerts_by_asset(db, current_user.id)

    groups = {asset_id: group for asset_id, group in groups.items() if len(group[1]) >= 2}
    counts, cases_by_asset = await _incident_context(db, current_user.id, groups)
    incidents = []
    for asset_id, (asset, alerts) in groups.items():
        alerts.sort(
            key=lambda a: _SEVERITY_RANK.get(_severity_value(a), -1), reverse=True
        )
        timestamps = [a.created_at for a in alerts if a.created_at]
        incidents.append({
            "asset_id": asset_id,
            "asset_name": asset.name,
            "asset_vendor": asset.vendor,
            "asset_product": asset.product,
            "asset_criticality": asset.criticality,
            "max_severity": _max_severity(alerts),
            "alert_count": len(alerts),
            "shared_cves": sorted({a.cve_id for a in alerts if a.cve_id}),
            "first_seen": min(timestamps).isoformat() if timestamps else None,
            "last_seen": max(timestamps).isoformat() if timestamps else None,
            "blast_radius": counts.get(asset.last_known_ip, 0),
            "linked_cases": cases_by_asset[asset_id],
            "alerts": [_alert_dict(a) for a in alerts],
        })

    if min_rank is not None:
        incidents = [i for i in incidents if _SEVERITY_RANK.get(i["max_severity"], -1) >= min_rank]
    if asset_term:
        incidents = [
            i for i in incidents
            if asset_term in (i["asset_name"] or "").lower()
            or asset_term in (i["asset_vendor"] or "").lower()
            or asset_term in (i["asset_product"] or "").lower()
        ]

    incidents.sort(
        key=lambda i: (_SEVERITY_RANK.get(i["max_severity"], -1), i["alert_count"]),
        reverse=True,
    )
    return {"total": len(incidents), "incidents": incidents}


@router.post("/{asset_id}/escalate", status_code=201)
async def escalate_incident(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Open an investigation case from an incident, linking all its active alerts."""
    asset = (await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.user_id == current_user.id)
    )).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    alerts = (await db.execute(
        select(Alert).where(
            Alert.asset_id == asset_id,
            Alert.user_id == current_user.id,
            Alert.status.in_(_ACTIVE_STATUSES),
        )
    )).scalars().all()
    if not alerts:
        raise HTTPException(status_code=400, detail="No active alerts on this asset")

    max_severity = _max_severity(alerts)
    cves = sorted({a.cve_id for a in alerts if a.cve_id})
    summary = (
        f"Incident escalated from {len(alerts)} active alerts on {asset.name}. "
        f"Highest severity: {max_severity}."
        + (f" CVEs: {', '.join(cves)}." if cves else "")
    )
    case = Case(
        user_id=current_user.id,
        title=f"Incident on {asset.name}",
        summary=summary[:2000],
        severity=max_severity,
        status="open",
        due_date=sla_due_date(current_user, max_severity),
    )
    db.add(case)
    await db.flush()
    for alert in alerts:
        db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
    add_audit_log(
        db,
        user_id=current_user.id,
        action="incident_escalated",
        target_type="case",
        target_id=case.id,
        detail=f"Incident on {asset.name} escalated to case {case.id} ({len(alerts)} alerts)",
    )
    await db.commit()
    return {
        "id": case.id,
        "title": case.title,
        "severity": max_severity,
        "alerts_linked": len(alerts),
    }


@router.get("/{asset_id}/timeline")
async def incident_timeline(
    asset_id: int,
    search: str | None = Query(None, max_length=200),
    kind: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Unified timeline for an incident: alert creation and field changes, newest first."""
    asset = (await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.user_id == current_user.id)
    )).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Keep owner scope on both sides of the union. Filter and page in SQL, so
    # older evidence is discoverable without loading every alert and audit row.
    creations = select(
        literal("alert_created").label("kind"), Alert.id.label("alert_id"),
        Alert.title.label("title"), (Alert.severity + " severity").label("detail"),
        Alert.created_at.label("timestamp"), literal(0).label("source"),
        Alert.id.label("event_id"),
    ).where(Alert.asset_id == asset_id, Alert.user_id == current_user.id)
    changes = select(
        AuditLog.action.label("kind"), Alert.id.label("alert_id"),
        Alert.title.label("title"), AuditLog.detail.label("detail"),
        AuditLog.timestamp.label("timestamp"), literal(1).label("source"),
        AuditLog.id.label("event_id"),
    ).join(Alert, AuditLog.target_id == Alert.id).where(
        Alert.asset_id == asset_id, Alert.user_id == current_user.id,
        AuditLog.user_id == current_user.id, AuditLog.target_type == "alert",
    )
    evidence = union_all(creations, changes).subquery()
    kinds = (await db.execute(select(evidence.c.kind).distinct().order_by(evidence.c.kind))).scalars().all()
    predicates = []
    if kind:
        predicates.append(evidence.c.kind == kind)
    if search and search.strip():
        term = search.strip()
        predicates.append(or_(
            evidence.c.title.icontains(term, autoescape=True),
            evidence.c.detail.icontains(term, autoescape=True),
            evidence.c.kind.icontains(term, autoescape=True),
            cast(evidence.c.alert_id, String).icontains(term, autoescape=True),
        ))
    total = (await db.execute(
        select(func.count()).select_from(evidence).where(*predicates)
    )).scalar_one()
    rows = (await db.execute(
        select(evidence).where(*predicates).order_by(
            evidence.c.timestamp.desc().nulls_last(), evidence.c.source.desc(),
            evidence.c.event_id.desc(),
        ).offset((page - 1) * page_size).limit(page_size)
    )).mappings().all()
    events = [{
        "kind": row["kind"], "alert_id": row["alert_id"], "title": row["title"],
        "detail": row["detail"],
        "timestamp": row["timestamp"].isoformat() if row["timestamp"] else None,
    } for row in rows]
    return {
        "asset_id": asset_id, "asset_name": asset.name, "events": events,
        "total": total, "page": page, "page_size": page_size, "kinds": kinds,
    }
