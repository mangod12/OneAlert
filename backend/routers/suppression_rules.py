"""Alert suppression rules CRUD. Matching rules auto-snooze newly created alerts."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog  # noqa: F401  (metadata registration)
from backend.models.suppression_rule import (
    AlertSuppressionRule,
    SuppressionRuleCreate,
    SuppressionRuleResponse,
    SuppressionRuleUpdate,
    criteria_set,
    rule_matches,
)
from backend.models.user import User
from backend.routers.suppression_preview import router as preview_router
from backend.services.audit import add_audit_log

router = APIRouter()
router.include_router(preview_router)

_ACTIVE_STATUSES = ("pending", "sent", "acknowledged")


def _status_value(alert: Alert) -> str:
    value = alert.status
    return value.value if hasattr(value, "value") else str(value)


def _severity_value(alert: Alert) -> str:
    value = alert.severity
    return value.value if hasattr(value, "value") else str(value)


async def _match_counts(db: AsyncSession, user_id: int, rules: list[AlertSuppressionRule]) -> dict[int, int]:
    """Count currently active alerts matching each rule."""
    rows = (
        await db.execute(
            select(Alert.cve_id, Alert.asset_id, Alert.severity, Alert.title, Alert.status).where(
                Alert.user_id == user_id
            )
        )
    ).all()
    active = [r for r in rows if (r[4].value if hasattr(r[4], "value") else str(r[4])) in _ACTIVE_STATUSES]
    counts: dict[int, int] = {}
    for rule in rules:
        counts[rule.id] = sum(
            1
            for cve_id, asset_id, severity, title, _ in active
            if rule_matches(
                rule,
                cve_id=cve_id,
                asset_id=asset_id,
                severity=severity.value if hasattr(severity, "value") else str(severity) if severity else None,
                title=title,
            )
        )
    return counts


@router.get("/", response_model=list[SuppressionRuleResponse])
async def list_suppression_rules(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    rules = (
        await db.execute(
            select(AlertSuppressionRule)
            .where(AlertSuppressionRule.user_id == current_user.id)
            .order_by(AlertSuppressionRule.created_at.desc())
        )
    ).scalars().all()
    counts = await _match_counts(db, current_user.id, rules)
    out = []
    for rule in rules:
        item = SuppressionRuleResponse.model_validate(rule)
        item.matching_active_alerts = counts[rule.id]
        out.append(item)
    return out


@router.post("/", response_model=SuppressionRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_suppression_rule(
    payload: SuppressionRuleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    if not criteria_set(payload.model_dump()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=("Set at least one criterion (CVE, asset, severity or title text); "
                    "an empty rule would snooze every alert."),
        )
    if payload.asset_id is not None:
        asset = await db.get(Asset, payload.asset_id)
        if not asset or asset.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    rule = AlertSuppressionRule(user_id=current_user.id, **payload.model_dump())
    db.add(rule)
    add_audit_log(
        db, user_id=current_user.id, action="create_suppression_rule",
        target_type="suppression_rule", target_id=None,
        detail=f"Suppression rule '{rule.name}' created",
    )
    await db.commit()
    await db.refresh(rule)
    return SuppressionRuleResponse.model_validate(rule)


@router.patch("/{rule_id}", response_model=SuppressionRuleResponse)
async def update_suppression_rule(
    rule_id: int,
    payload: SuppressionRuleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    rule = await db.get(AlertSuppressionRule, rule_id)
    if not rule or rule.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suppression rule not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("asset_id") is not None:
        asset = await db.get(Asset, updates["asset_id"])
        if not asset or asset.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    merged = {
        "cve_id": rule.cve_id, "asset_id": rule.asset_id,
        "severity": rule.severity, "title_contains": rule.title_contains,
        **{k: v for k, v in updates.items() if k in ("cve_id", "asset_id", "severity", "title_contains")},
    }
    if not criteria_set(merged):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=("Set at least one criterion (CVE, asset, severity or title text); "
                    "an empty rule would snooze every alert."),
        )
    for field, value in updates.items():
        setattr(rule, field, value)
    add_audit_log(
        db, user_id=current_user.id, action="update_suppression_rule",
        target_type="suppression_rule", target_id=rule.id,
        detail=f"Suppression rule '{rule.name}' updated",
    )
    await db.commit()
    await db.refresh(rule)
    return SuppressionRuleResponse.model_validate(rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_suppression_rule(
    rule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    rule = await db.get(AlertSuppressionRule, rule_id)
    if not rule or rule.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suppression rule not found")
    add_audit_log(
        db, user_id=current_user.id, action="delete_suppression_rule",
        target_type="suppression_rule", target_id=rule.id,
        detail=f"Suppression rule '{rule.name}' deleted",
    )
    await db.delete(rule)
    await db.commit()
