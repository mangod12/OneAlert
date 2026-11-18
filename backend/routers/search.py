"""Global search across alerts, cases and assets for the command palette."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
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
    """Search the current user's alerts, cases and assets by text."""
    like = f"%{q}%"

    alerts = (await db.execute(
        select(Alert)
        .where(
            Alert.user_id == current_user.id,
            or_(Alert.title.ilike(like), Alert.description.ilike(like),
                Alert.cve_id.ilike(like)),
        )
        .order_by(Alert.created_at.desc())
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

    cases = (await db.execute(
        select(Case)
        .where(
            Case.user_id == current_user.id,
            or_(Case.title.ilike(like), Case.summary.ilike(like)),
        )
        .order_by(Case.created_at.desc())
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

    assets = (await db.execute(
        select(Asset)
        .where(
            Asset.user_id == current_user.id,
            or_(Asset.name.ilike(like), Asset.vendor.ilike(like),
                Asset.product.ilike(like)),
        )
        .order_by(Asset.name)
        .limit(PER_GROUP_LIMIT)
    )).scalars().all()

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
            "query": q,
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
