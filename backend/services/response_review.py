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
