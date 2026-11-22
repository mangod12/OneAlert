"""Review complete saved-rule edits and current match deltas, then update conditionally."""

from datetime import UTC, datetime
from hmac import compare_digest
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictInt, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.suppression_rule import AlertSuppressionRule, criteria_set, rule_matches
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.suppression_review import (
    REVIEW_COLUMNS,
    reviewed_creation_predicate,
    suppression_rule_fingerprint,
    suppression_rule_snapshot,
)

router = APIRouter()
_ACTIVE_ALERT_LIMIT = 50000
_EXAMPLE_LIMIT = 10


class SuppressionEditProposal(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    cve_id: str | None = Field(max_length=16384)
    asset_id: StrictInt | None = Field(gt=0)
    severity: str | None = Field(pattern="^(low|medium|high|critical)$")
    title_contains: str | None = Field(max_length=16384)
    duration_hours: StrictInt = Field(ge=1, le=720)
    model_config = {"extra": "forbid", "strict": True}

    @model_validator(mode="after")
    def needs_criterion(self):
        if not self.name.strip() or not criteria_set(self.model_dump()):
            raise ValueError(
                "Use a nonblank name and at least one criterion. Literal criterion whitespace is preserved."
            )
        return self


class ReviewedSuppressionEdit(BaseModel):
    expected_fingerprint: str = Field(pattern="^[a-f0-9]{64}$")
    proposal: SuppressionEditProposal
    model_config = {"extra": "forbid", "strict": True}

    @model_validator(mode="before")
    @classmethod
    def serializable_error_inputs(cls, value):
        # Validation errors echo input; refuse invalid Unicode before an error can echo it.
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, str):
                try:
                    item.encode("utf-8")
                except UnicodeEncodeError as exc:
                    raise HTTPException(422, "Text must contain valid Unicode characters") from exc
            elif isinstance(item, dict):
                pending.extend(item.keys())
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        return value


async def _owned_rule(db, user_id, rule_id):
    rule = await db.get(AlertSuppressionRule, rule_id, populate_existing=True)
    if rule is None or rule.user_id != user_id:
        raise HTTPException(404, "Suppression rule not found")
    return rule


async def _checked_edit(db, user_id, rule_id, payload):
    rule = await _owned_rule(db, user_id, rule_id)
    before = suppression_rule_snapshot(rule)
    if not compare_digest(payload.expected_fingerprint, suppression_rule_fingerprint(before)):
        raise HTTPException(409, "The saved rule changed since review. No edit was made. Read it again.")
    values = payload.proposal.model_dump()
    if all(before[key] == value for key, value in values.items()):
        raise HTTPException(409, "The proposal has no saved-value changes. No edit was made.")
    if values["asset_id"] is not None:
        asset = await db.get(Asset, values["asset_id"], populate_existing=True)
        if asset is None or asset.user_id != user_id:
            raise HTTPException(404, "Asset not found")
    return rule, before, {**before, **values}


def _value(value):
    return value.value if hasattr(value, "value") else str(value) if value is not None else None


@router.get("/{rule_id}/edit-review")
async def read_suppression_edit(
    rule_id: int,
    user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    snapshot = suppression_rule_snapshot(await _owned_rule(db, user.id, rule_id))
    return {"version": 1, "rule": snapshot, "rule_fingerprint": suppression_rule_fingerprint(snapshot),
            "retrieved_at": datetime.now(UTC).isoformat()}


@router.post("/{rule_id}/edit-preview")
async def preview_suppression_edit(
    rule_id: int,
    payload: ReviewedSuppressionEdit,
    user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    _, before, proposed = await _checked_edit(db, user.id, rule_id, payload)
    original, candidate = SimpleNamespace(**before), SimpleNamespace(**proposed)
    before_has_criteria = criteria_set(before)
    totals = dict(retained=0, added=0, removed=0)
    examples = {key: [] for key in totals}
    rows = await db.stream(select(
        Alert.id, Alert.asset_id, Alert.title, Alert.cve_id, Alert.severity, Alert.status, Alert.created_at,
    ).where(Alert.user_id == user.id, Alert.status.in_(("pending", "sent", "acknowledged")))
        .order_by(Alert.id.desc()).limit(_ACTIVE_ALERT_LIMIT + 1))
    active_count = 0
    async for alert in rows:
        active_count += 1
        if active_count > _ACTIVE_ALERT_LIMIT:
            raise HTTPException(
                422, "Edit preview supports at most 50000 current active alerts. No partial counts returned."
            )
        values = dict(cve_id=alert.cve_id, asset_id=alert.asset_id, severity=_value(alert.severity), title=alert.title)
        old = before_has_criteria and rule_matches(original, **values)
        new = rule_matches(candidate, **values)
        bucket = "retained" if old and new else "added" if new else "removed" if old else None
        if bucket is not None:
            totals[bucket] += 1
            if len(examples[bucket]) < _EXAMPLE_LIMIT:
                examples[bucket].append(dict(id=alert.id, asset_id=alert.asset_id, title=alert.title,
                                             cve_id=alert.cve_id, severity=_value(alert.severity),
                                             status=_value(alert.status), created_at=alert.created_at))
    return {"version": 1, "scope": "active", "active_alert_limit": _ACTIVE_ALERT_LIMIT,
            "example_limit": _EXAMPLE_LIMIT, "active_alert_count": active_count,
            "rule": before, "rule_fingerprint": suppression_rule_fingerprint(before),
            "proposed_rule": proposed, "proposed_rule_fingerprint": suppression_rule_fingerprint(proposed),
            "before_count": totals["retained"] + totals["removed"],
            "after_count": totals["retained"] + totals["added"],
            "counts": totals, "examples": examples, "retrieved_at": datetime.now(UTC).isoformat()}


@router.post("/{rule_id}/reviewed-edit")
async def apply_suppression_edit(
    rule_id: int,
    payload: ReviewedSuppressionEdit,
    user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    rule, _, _ = await _checked_edit(db, user.id, rule_id, payload)
    predicates = [AlertSuppressionRule.id == rule_id, AlertSuppressionRule.user_id == user.id]
    predicates.extend(getattr(AlertSuppressionRule, key) == getattr(rule, key) for key in REVIEW_COLUMNS)
    predicates.append(reviewed_creation_predicate(rule, db.get_bind().dialect.name))
    if payload.proposal.asset_id is not None:
        predicates.append(select(Asset.id).where(
            Asset.id == payload.proposal.asset_id, Asset.user_id == user.id,
        ).exists())
    result = await db.execute(update(AlertSuppressionRule).where(*predicates).values(
        **payload.proposal.model_dump(),
    ).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(
            409, "Saved rule or asset ownership changed during confirmation. No edit was made. Read it again."
        )
    add_audit_log(db, user_id=user.id, action="reviewed_suppression_edit", target_type="suppression_rule",
                  target_id=rule_id, detail="Reviewed rule name, criteria or snooze window edited; enabled unchanged")
    await db.commit()
    await db.refresh(rule)
    snapshot = suppression_rule_snapshot(rule)
    return {"conditional_update_applied": True, "reviewed_fingerprint": payload.expected_fingerprint,
            "rule": snapshot, "rule_fingerprint": suppression_rule_fingerprint(snapshot)}
