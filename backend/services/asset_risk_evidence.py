"""Explain the inventory risk calculation using current owner-visible alert evidence."""
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.alert import Alert, AlertStatus
from backend.models.asset import Asset

_SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_CRITICALITY_MULTIPLIER = {"critical": 2.0, "high": 1.5, "medium": 1.0, "low": 0.5}
_ACTIVE_ALERT_STATUSES = [AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED]


def _severity_weight(severity) -> int:
    sev = severity.value if hasattr(severity, "value") else str(severity or "").lower()
    return _SEVERITY_WEIGHT.get(sev, 1)


def _risk_level(score: int) -> str:
    if score >= 40:
        return "critical"
    if score >= 15:
        return "high"
    if score >= 5:
        return "medium"
    if score > 0:
        return "low"
    return "none"


def _risk_score(asset: Asset, base: int) -> int:
    multiplier = _CRITICALITY_MULTIPLIER.get(str(asset.criticality or "medium").lower(), 1.0)
    return min(100, round(base * multiplier))


async def _risk_base_scores(db: AsyncSession, user_id: int, asset_ids: list[int]) -> dict[int, int]:
    """Severity-weighted sum of each asset's active alerts."""
    if not asset_ids:
        return {}
    rows = await db.execute(
        select(Alert.asset_id, Alert.severity).where(
            Alert.user_id == user_id,
            Alert.asset_id.in_(asset_ids),
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
        )
    )
    bases: dict[int, int] = {}
    for asset_id, severity in rows.all():
        bases[asset_id] = bases.get(asset_id, 0) + _severity_weight(severity)
    return bases




async def asset_risk_evidence(db, asset, user_id, page, size):
    predicates = [Alert.user_id == user_id, Alert.asset_id == asset.id]
    groups = (await db.execute(select(Alert.status, Alert.severity, func.count())
                              .where(*predicates).group_by(Alert.status, Alert.severity))).all()
    severity_counts = {}
    statuses = {}
    total = 0
    for alert_status, severity, count in groups:
        status_text = alert_status.value if hasattr(alert_status, "value") else str(alert_status)
        statuses[status_text] = statuses.get(status_text, 0) + count
        if alert_status in _ACTIVE_ALERT_STATUSES:
            key = severity.value if hasattr(severity, "value") else str(severity or "unknown").lower()
            severity_counts[key] = severity_counts.get(key, 0) + count
            total += count
    breakdown = [{"severity": severity, "count": count, "weight": _severity_weight(severity),
                  "base_points": count * _severity_weight(severity)}
                 for severity, count in sorted(
                     severity_counts.items(), key=lambda item: (-_severity_weight(item[0]), item[0]),
                 )]
    base = sum(row["base_points"] for row in breakdown)
    multiplier = _CRITICALITY_MULTIPLIER.get(str(asset.criticality or "medium").lower(), 1.0)
    weight_order = case(_SEVERITY_WEIGHT, value=func.lower(Alert.severity), else_=1)
    records = (await db.execute(select(Alert).where(*predicates, Alert.status.in_(_ACTIVE_ALERT_STATUSES))
                               .order_by(weight_order.desc(), Alert.id.desc())
                               .offset((page - 1) * size).limit(size))).scalars().all()
    score = _risk_score(asset, base)
    return {"asset_id": asset.id, "asset_name": asset.name, "criticality": asset.criticality,
            "multiplier": multiplier, "base_points": base, "rounded_points": round(base * multiplier),
            "score": score, "level": _risk_level(score), "severity_breakdown": breakdown,
            "included_statuses": [value.value for value in _ACTIVE_ALERT_STATUSES],
            "status_counts": statuses, "total": total, "page": page, "size": size,
            "retrieved_at": datetime.now(UTC).isoformat(),
            "records": [{"id": row.id, "title": row.title, "severity": row.severity, "status": row.status,
                         "base_points": _severity_weight(row.severity), "cve_id": row.cve_id,
                         "created_at": row.created_at} for row in records]}
