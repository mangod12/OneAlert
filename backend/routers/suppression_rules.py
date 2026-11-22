"""Alert suppression rules CRUD. Matching rules auto-snooze newly created alerts."""

from datetime import UTC, datetime
from hmac import compare_digest
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog  # noqa: F401  (metadata registration)
from backend.models.suppression_rule import (
    AlertSuppressionRule,
    ReviewedSuppressionStatus,
    SuppressionRuleCreate,
    SuppressionRuleResponse,
    SuppressionRuleUpdate,
    criteria_set,
    rule_matches,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.suppression_preview import router as preview_router
from backend.services.audit import add_audit_log
from backend.services.suppression_review import (
    REVIEW_COLUMNS,
    reviewed_creation_predicate,
    suppression_rule_fingerprint,
    suppression_rule_snapshot,
)

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


@router.get("/{rule_id}/matching-alerts")
async def inspect_rule_matches(
    rule_id: int,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    search: Annotated[str, Query(max_length=200)] = "",
    scope: Literal["active", "all"] = "active",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read existing matching alerts without claiming this rule caused their state."""
    rule = (await db.execute(select(AlertSuppressionRule).where(
        AlertSuppressionRule.id == rule_id, AlertSuppressionRule.user_id == current_user.id,
    ))).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Suppression rule not found")
    query = search.strip()
    term = query.lower()
    # Use the exact runtime matcher, including Python's Unicode case handling, rather than
    # introducing different SQL LIKE wildcard or collation semantics for the preview.
    alerts = await db.stream_scalars(select(Alert).where(Alert.user_id == current_user.id).order_by(Alert.id.desc()))
    matching_total, total, rows = 0, 0, []
    async for alert in alerts:
        if scope == "active" and _status_value(alert) not in _ACTIVE_STATUSES:
            continue
        if not rule_matches(rule, cve_id=alert.cve_id, asset_id=alert.asset_id,
                            severity=_severity_value(alert), title=alert.title):
            continue
        matching_total += 1
        if term and not any(term in str(value or "").lower() for value in (alert.id, alert.title, alert.cve_id)):
            continue
        if (page - 1) * size <= total < page * size:
            rows.append({"id": alert.id, "asset_id": alert.asset_id, "title": alert.title,
                         "cve_id": alert.cve_id, "severity": _severity_value(alert), "status": _status_value(alert),
                         "created_at": alert.created_at})
        total += 1
    snapshot = suppression_rule_snapshot(rule)
    return {"rule": snapshot, "rule_fingerprint": suppression_rule_fingerprint(snapshot),
            "page": page, "size": size,
            "search": query, "scope": scope, "total": total, "matching_total": matching_total,
            "criteria_present": criteria_set({field: getattr(rule, field)
                                              for field in ("cve_id", "asset_id", "severity", "title_contains")}),
            "retrieved_at": datetime.now(UTC).isoformat(), "alerts": rows}


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


@router.post("/{rule_id}/reviewed-status")
async def change_reviewed_suppression_status(
    rule_id: int,
    payload: ReviewedSuppressionStatus,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Change only enabled, conditionally against every reviewed saved rule value."""
    rule = await db.get(AlertSuppressionRule, rule_id, populate_existing=True)
    if rule is None or rule.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Suppression rule not found")
    snapshot = suppression_rule_snapshot(rule)
    if not compare_digest(payload.expected_fingerprint, suppression_rule_fingerprint(snapshot)):
        raise HTTPException(409, "Suppression rule changed since review. No status change was made. Read it again.")
    if rule.enabled == payload.enabled:
        raise HTTPException(409, "This rule already has the requested status. No status change was made.")
    if payload.enabled and not criteria_set(snapshot):
        raise HTTPException(422, "An empty-criteria rule cannot be enabled.")
    predicates = [AlertSuppressionRule.id == rule_id, AlertSuppressionRule.user_id == current_user.id]
    predicates.extend(getattr(AlertSuppressionRule, field) == getattr(rule, field) for field in REVIEW_COLUMNS)
    predicates.append(reviewed_creation_predicate(rule, db.get_bind().dialect.name))
    result = await db.execute(update(AlertSuppressionRule).where(*predicates).values(
        enabled=payload.enabled,
    ).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(
            409, "Suppression rule changed during confirmation. No status change was made. Read it again.",
        )
    add_audit_log(db, user_id=current_user.id, action="reviewed_suppression_status",
                  target_type="suppression_rule", target_id=rule_id,
                  detail=f"Reviewed rule status changed to {'enabled' if payload.enabled else 'paused'}")
    await db.commit()
    await db.refresh(rule)
    current = suppression_rule_snapshot(rule)
    return {"conditional_update_applied": True, "reviewed_fingerprint": payload.expected_fingerprint,
            "rule": current, "rule_fingerprint": suppression_rule_fingerprint(current)}


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
