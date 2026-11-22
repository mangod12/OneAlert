"""Bind suppression status review to complete saved rule values, not match counts."""

import hashlib
import json

from sqlalchemy import String, case, cast, func

from backend.models.suppression_rule import AlertSuppressionRule, SuppressionRuleResponse

REVIEW_COLUMNS = (
    "name", "cve_id", "asset_id", "severity", "title_contains",
    "duration_hours", "enabled",
)


def reviewed_creation_predicate(rule: AlertSuppressionRule, dialect: str):
    if dialect != "sqlite":
        return AlertSuppressionRule.created_at == rule.created_at
    # SQLite's CURRENT_TIMESTAMP stores seconds, while datetime binds include fractions.
    # Normalize trailing fractional zeros only, retaining all significant microseconds.
    recorded = cast(AlertSuppressionRule.created_at, String)
    normalized = case((func.instr(recorded, ".") > 0, func.rtrim(func.rtrim(recorded, "0"), ".")),
                      else_=recorded)
    expected = rule.created_at.replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")
    return normalized == expected.rstrip("0").rstrip(".")


def suppression_rule_snapshot(rule: AlertSuppressionRule) -> dict:
    return SuppressionRuleResponse.model_validate(rule).model_dump(
        mode="json", exclude={"matching_active_alerts"},
    )


def suppression_rule_fingerprint(snapshot: dict) -> str:
    wire = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("onealert_suppression_rule_status_v1\0" + wire).encode("utf-8")).hexdigest()
