"""Read-only current notification preference explanations, never delivery or history."""

import hashlib
import json
import re
from datetime import UTC, datetime, time
from math import isfinite
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError, model_validator

from backend.models.user import NotificationPreferences, User
from backend.routers.auth import get_active_user
from backend.services.notification_prefs import (
    SEVERITY_RANK,
    in_quiet_hours,
    is_kind_muted,
    should_email_event,
    should_email_user,
)

router = APIRouter()
Scenario = Literal[
    "new_alert", "alert_updated", "alert_mention", "case_mention", "case_updated", "case_assigned",
    "incident_escalated", "case_sla_breached", "case_sla_due_soon", "case_task_due_soon", "case_task_overdue",
]
Severity = Literal["low", "medium", "high", "critical"]
_CLOCK = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z")


def _check_json_values(value):
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeEncodeError as exc:
                raise HTTPException(422, "Policy text must contain valid Unicode characters") from exc
        elif isinstance(item, float) and not isfinite(item):
            raise HTTPException(422, "Policy values must contain only finite JSON numbers")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


class PolicyPreviewRequest(BaseModel):
    expected_fingerprint: str = Field(pattern="^[a-f0-9]{64}$", min_length=64, max_length=64)
    scenario: Scenario
    severity: Severity | None
    utc_time: str | None = Field(pattern="^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", min_length=5, max_length=5)
    model_config = {"extra": "forbid", "strict": True}

    @model_validator(mode="before")
    @classmethod
    def encodable_errors(cls, value):
        # Validation errors echo input; reject values the JSON error response cannot encode.
        return _check_json_values(value)


def saved_policy(user) -> dict:
    try:
        snapshot = NotificationPreferences.model_validate(user).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, "The saved notification preferences could not be verified. Review Settings.") from exc
    _check_json_values(snapshot)
    if (len(snapshot["notify_min_severity"]) > 100 or len(snapshot["muted_kinds"]) > 100
            or any(not kind or len(kind) > 100 for kind in snapshot["muted_kinds"])
            or not 0 <= snapshot["digest_hour_utc"] <= 23
            or any(value is not None and not _CLOCK.fullmatch(value)
                   for value in (snapshot["quiet_hours_start"], snapshot["quiet_hours_end"]))):
        raise HTTPException(422, "The saved notification preferences use unsupported values. Review Settings.")
    return snapshot


def policy_fingerprint(snapshot: dict) -> str:
    wire = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("onealert_notification_policy_v1\0" + wire).encode()).hexdigest()


def policy_evaluation(user, scenario: str, severity: str | None, clock: time) -> dict:
    """Explain only the shared predicate used when a supported dispatch path is reached."""
    kind = "alert_created" if scenario == "new_alert" else scenario
    kind_gate = scenario != "new_alert"
    muted = is_kind_muted(user, kind)
    quiet = in_quiet_hours(user, clock)
    raw_minimum = str(user.notify_min_severity or "low").lower()
    minimum = raw_minimum if raw_minimum in SEVERITY_RANK else "medium"
    start, end = user.quiet_hours_start, user.quiet_hours_end
    window = ("unset" if start is None and end is None else "incomplete" if start is None or end is None
              else "zero_length" if start == end else "configured")

    def decision(level):
        reasons = []
        if not user.email_notifications_enabled:
            reasons.append("email_disabled")
        if kind_gate and muted:
            reasons.append("kind_muted")
        if quiet and level != "critical":
            reasons.append("quiet_hours")
        if level is not None and SEVERITY_RANK[level] < SEVERITY_RANK[minimum]:
            reasons.append("below_minimum")
        allowed = (should_email_event(user, kind, level, clock) if kind_gate
                   else should_email_user(user, level, clock))
        if allowed != (not reasons):
            raise HTTPException(500, "The preference predicate and explanation disagree. No results are available.")
        return {"severity": level, "allowed_by_preference_predicate": allowed, "blocking_reasons": reasons}

    return {
        "kind": kind,
        "predicate": "investigation_dispatch" if kind_gate else "new_alert_email",
        "gates": {"email_enabled": user.email_notifications_enabled, "kind_is_muted": muted,
                  "kind_gate_applies": kind_gate, "quiet_window_state": window, "inside_quiet_hours": quiet,
                  "critical_quiet_bypass": quiet and severity == "critical", "effective_minimum": minimum,
                  "minimum_fallback": raw_minimum not in SEVERITY_RANK,
                  "unknown_severity": severity is None,
                  "severity_meets_minimum": severity is None or SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum]},
        "selected": decision(severity),
        "severity_matrix": [decision(level) for level in ("low", "medium", "high", "critical", None)],
        "feed_kind_hidden_by_saved_mute": muted,
    }


@router.get("/policy-review")
async def read_notification_policy(user: User = Depends(get_active_user)):
    snapshot = saved_policy(user)
    return {"version": 1, "preferences": snapshot, "preferences_fingerprint": policy_fingerprint(snapshot),
            "retrieved_at": datetime.now(UTC).isoformat()}


@router.post("/policy-preview")
async def preview_notification_policy(payload: PolicyPreviewRequest, user: User = Depends(get_active_user)):
    snapshot = saved_policy(user)
    fingerprint = policy_fingerprint(snapshot)
    if payload.expected_fingerprint != fingerprint:
        raise HTTPException(409, "Saved notification preferences changed. Read them again; no preview was retained.")
    evaluated = datetime.now(UTC)
    clock = evaluated.time() if payload.utc_time is None else time.fromisoformat(payload.utc_time)
    return {"version": 1, "preferences": snapshot, "preferences_fingerprint": fingerprint,
            "retrieved_at": evaluated.isoformat(),
            "request": {"scenario": payload.scenario, "severity": payload.severity, "utc_time": payload.utc_time},
            "tested_utc_time": clock.strftime("%H:%M"),
            "time_basis": "current_utc" if payload.utc_time is None else "chosen_utc_clock",
            **policy_evaluation(user, payload.scenario, payload.severity, clock)}
