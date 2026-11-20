"""Global search across alerts, cases, assets and saved events for the command palette."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()

PER_GROUP_LIMIT = 5


@router.get("/")
async def global_search(
    q: str = Query(..., min_length=2, max_length=200),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Search owned records by literal normalized text, never raw event payload contents."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Search needs at least two non-padding characters")
    like = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'

    alerts = (await db.execute(
        select(Alert)
        .where(
            Alert.user_id == current_user.id,
            or_(Alert.title.ilike(like, escape='\\'), Alert.description.ilike(like, escape='\\'),
                Alert.cve_id.ilike(like, escape='\\')),
        )
        .order_by(Alert.created_at.desc(), Alert.id.desc())
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

    cases = (await db.execute(
        select(Case)
        .where(
            Case.user_id == current_user.id,
            or_(Case.title.ilike(like, escape='\\'), Case.summary.ilike(like, escape='\\')),
        )
        .order_by(Case.created_at.desc(), Case.id.desc())
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

    assets = (await db.execute(
        select(Asset)
        .where(
            Asset.user_id == current_user.id,
            or_(Asset.name.ilike(like, escape='\\'), Asset.vendor.ilike(like, escape='\\'),
                Asset.product.ilike(like, escape='\\')),
        )
        .order_by(Asset.name, Asset.id)
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

    event_terms = [getattr(SecurityEvent, field).ilike(like, escape='\\') for field in (
        'signature', 'signature_id', 'hostname', 'source_ip', 'dest_ip', 'category', 'event_type',
    )]
    if query.isascii() and query.isdigit() and 0 < int(query) <= 2147483647:
        event_terms.append(SecurityEvent.id == int(query))
    events = (await db.execute(select(SecurityEvent).where(
        SecurityEvent.user_id == current_user.id, or_(*event_terms),
    ).order_by(SecurityEvent.timestamp.desc(), SecurityEvent.id.desc()).limit(PER_GROUP_LIMIT))).scalars().all()

    def severity_value(alert: Alert) -> str:
        severity = alert.severity
        return severity.value if hasattr(severity, "value") else str(severity)

    # Surface incidents (2+ active alerts) behind assets that matched the query
    incidents = []
    if assets:
        asset_ids = [a.id for a in assets]
        active = (await db.execute(
            select(Alert).where(
                Alert.user_id == current_user.id,
                Alert.asset_id.in_(asset_ids),
                Alert.status.in_(("pending", "sent", "acknowledged")),
            )
        )).scalars().all()
        by_asset: dict[int, list[Alert]] = {}
        for alert in active:
            by_asset.setdefault(alert.asset_id, []).append(alert)
        severity_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        for asset in assets:
            group = by_asset.get(asset.id, [])
            if len(group) >= 2:
                incidents.append({
                    "asset_id": asset.id,
                    "asset_name": asset.name,
                    "alert_count": len(group),
                    "max_severity": max(
                        (severity_value(a) for a in group),
                        key=lambda s: severity_rank.get(s, -1),
                    ),
                })

    return {
        "success": True,
        "data": {
            "query": query,
            "events": [{"id": event.id, "signature": event.signature, "event_type": event.event_type,
                        "severity": event.severity, "timestamp": event.timestamp,
                        "source_ip": event.source_ip, "dest_ip": event.dest_ip} for event in events],
            "alerts": [
                {"id": a.id, "title": a.title, "severity": severity_value(a),
                 "status": a.status}
                for a in alerts
            ],
            "cases": [
                {"id": c.id, "title": c.title, "status": c.status,
                 "severity": c.severity}
                for c in cases
            ],
            "assets": [
                {"id": a.id, "name": a.name, "vendor": a.vendor,
                 "asset_type": a.asset_type}
                for a in assets
            ],
            "incidents": incidents,
        },
    }
