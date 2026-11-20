"""Counterfactual draft-rule review. This endpoint never saves or applies a rule."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.suppression_rule import AlertSuppressionRule, SuppressionRuleCreate, criteria_set, rule_matches
from backend.models.user import User

router = APIRouter()


def _value(value):
    return value.value if hasattr(value, 'value') else str(value) if value is not None else None


@router.post('/preview')
async def preview_suppression_draft(
    payload: SuppressionRuleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    proposal = payload.model_dump()
    if not criteria_set(proposal):
        raise HTTPException(status_code=422, detail='Set at least one criterion before previewing a rule.')
    if payload.asset_id is not None:
        asset = (await db.execute(select(Asset).where(
            Asset.id == payload.asset_id, Asset.user_id == current_user.id,
        ))).scalar_one_or_none()
        if asset is None:
            raise HTTPException(status_code=404, detail='Asset not found')
    rule = AlertSuppressionRule(user_id=current_user.id, **proposal)
    rows = await db.stream_scalars(select(Alert).where(Alert.user_id == current_user.id).order_by(Alert.id.desc()))
    active_total, match_total, examples = 0, 0, []
    async for alert in rows:
        if _value(alert.status) not in ('pending', 'sent', 'acknowledged'):
            continue
        active_total += 1
        if not rule_matches(rule, cve_id=alert.cve_id, asset_id=alert.asset_id,
                            severity=_value(alert.severity), title=alert.title):
            continue
        match_total += 1
        if len(examples) < 10:
            examples.append({'id': alert.id, 'asset_id': alert.asset_id, 'title': alert.title,
                             'cve_id': alert.cve_id, 'severity': _value(alert.severity),
                             'status': _value(alert.status)})
    return {'proposal': proposal, 'active_alert_count': active_total, 'matching_alert_count': match_total,
            'example_limit': 10, 'examples': examples, 'previewed_at': datetime.now(UTC).isoformat()}
