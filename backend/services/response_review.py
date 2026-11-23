"""Bind human approval to the saved response plan evidence that was reviewed."""

import hashlib
import json

from backend.models.response_plan import ResponsePlan


def review_fingerprint(plan: ResponsePlan) -> str:
    """A content fingerprint, not a grant, signature or substitute for owner checks."""
    payload = {
        "schema_version": 1,
        "plan_id": plan.id,
        "owner_id": plan.user_id,
        "case_id": plan.case_id,
        "status": plan.status,
        "autonomy_level": plan.autonomy_level,
        "actions": plan.actions,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def deletion_fingerprint(plan: ResponsePlan, approvals) -> str:
    """Bind removal to the plan plus every approval decision that will be erased."""
    payload = {
        "schema_version": 1,
        "plan_fingerprint": review_fingerprint(plan),
        "created_by": plan.created_by,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "approved_by": plan.approved_by,
        "approved_at": plan.approved_at.isoformat() if plan.approved_at else None,
        "approvals": [{field: (value.isoformat() if hasattr(value, "isoformat") else value)
                       for field in ("id", "plan_id", "requested_by", "status", "reason", "reviewed_by",
                                     "reviewed_at", "created_at")
                       for value in (getattr(row, field),)} for row in sorted(approvals, key=lambda item: item.id)],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
