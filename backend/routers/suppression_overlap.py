"""Read-only current-alert overlap, not suppression history or rule precedence."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert
from backend.models.suppression_rule import AlertSuppressionRule, criteria_set, rule_matches
from backend.models.user import User
from backend.services.suppression_review import suppression_rule_fingerprint, suppression_rule_snapshot

router = APIRouter()
_OTHER_RULE_LIMIT = 200
_EXAMPLE_LIMIT = 10
_ACTIVE_ALERT_LIMIT = 50000


def _value(value):
    return value.value if hasattr(value, "value") else str(value) if value is not None else None


def _has_criteria(rule):
    return criteria_set({field: getattr(rule, field) for field in ("cve_id", "asset_id", "severity", "title_contains")})


@router.get("/{rule_id}/overlap-review")
async def inspect_suppression_overlap(
    rule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    selected = await db.get(AlertSuppressionRule, rule_id)
    if selected is None or selected.user_id != current_user.id:
        raise HTTPException(404, "Suppression rule not found")
    if not _has_criteria(selected):
        raise HTTPException(
            422, "Overlap review needs a saved criterion. Automatic suppression skips empty-criteria rules."
        )
    selected_snapshot = suppression_rule_snapshot(selected)
    other_rules = (
        (
            await db.execute(
                select(AlertSuppressionRule)
                .where(
                    AlertSuppressionRule.user_id == current_user.id,
                    AlertSuppressionRule.id != rule_id,
                    AlertSuppressionRule.enabled.is_(True),
                )
                .order_by(AlertSuppressionRule.id)
                .limit(_OTHER_RULE_LIMIT + 1)
            )
        )
        .scalars()
        .all()
    )
    if len(other_rules) > _OTHER_RULE_LIMIT:
        raise HTTPException(
            422, "This review supports at most 200 other enabled rules. No partial overlap counts were returned."
        )
    compared = [rule for rule in other_rules if _has_criteria(rule)]
    snapshots = {rule.id: suppression_rule_snapshot(rule) for rule in compared}
    counts = {rule.id: 0 for rule in compared}
    alerts = await db.stream(
        select(Alert.id, Alert.asset_id, Alert.title, Alert.cve_id, Alert.severity, Alert.status, Alert.created_at)
        .where(
            Alert.user_id == current_user.id,
            Alert.status.in_(("pending", "sent", "acknowledged")),
        )
        .order_by(Alert.id.desc())
        .limit(_ACTIVE_ALERT_LIMIT + 1)
    )
    active_count, matching, shared, examples = 0, 0, 0, []
    async for alert in alerts:
        active_count += 1
        if active_count > _ACTIVE_ALERT_LIMIT:
            raise HTTPException(
                422,
                "This review supports at most 50000 current active alerts. No partial overlap counts were returned.",
            )
        values = {
            "cve_id": alert.cve_id,
            "asset_id": alert.asset_id,
            "severity": _value(alert.severity),
            "title": alert.title,
        }
        if not rule_matches(selected, **values):
            continue
        matching += 1
        other_ids = [rule.id for rule in compared if rule_matches(rule, **values)]
        if other_ids:
            shared += 1
        for identity in other_ids:
            counts[identity] += 1
        if len(examples) < _EXAMPLE_LIMIT:
            examples.append(
                {
                    "alert": {
                        "id": alert.id,
                        "asset_id": alert.asset_id,
                        "title": alert.title,
                        "cve_id": alert.cve_id,
                        "severity": _value(alert.severity),
                        "status": _value(alert.status),
                        "created_at": alert.created_at,
                    },
                    "other_rule_ids": other_ids,
                }
            )
    overlap = [
        {
            "rule": snapshots[identity],
            "rule_fingerprint": suppression_rule_fingerprint(snapshots[identity]),
            "matching_alert_count": count,
        }
        for identity, count in sorted(counts.items(), key=lambda row: (-row[1], row[0]))
        if count
    ]
    return {
        "version": 1,
        "active_alert_limit": _ACTIVE_ALERT_LIMIT,
        "active_alert_count": active_count,
        "scope": "active",
        "example_limit": _EXAMPLE_LIMIT,
        "other_enabled_rule_limit": _OTHER_RULE_LIMIT,
        "rule": selected_snapshot,
        "rule_fingerprint": suppression_rule_fingerprint(selected_snapshot),
        "other_enabled_rule_count": len(other_rules),
        "compared_other_rule_count": len(compared),
        "ignored_empty_other_rule_count": len(other_rules) - len(compared),
        "matching_alert_count": matching,
        "shared_matching_alert_count": shared,
        "exclusive_matching_alert_count": matching - shared,
        "overlapping_rules": overlap,
        "examples": examples,
        "retrieved_at": datetime.now(UTC).isoformat(),
    }
