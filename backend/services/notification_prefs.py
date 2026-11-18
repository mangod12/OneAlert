"""Shared per-user notification preference checks.

Quiet hours, minimum severity and muted kinds decide whether an event
also goes out by email; every notification still lands in-app.
"""

import re
from datetime import UTC, datetime
from datetime import time as _time

SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

_QUIET_HOURS_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def in_quiet_hours(user, now: _time | None = None) -> bool:
    """True when the wall-clock time falls inside the user's quiet-hours window.

    The window can span midnight ("22:00" to "06:00"). Stored as HH:MM strings;
    compared in UTC because no per-user timezone is tracked.
    """
    start_raw = getattr(user, "quiet_hours_start", None)
    end_raw = getattr(user, "quiet_hours_end", None)
    start_match = _QUIET_HOURS_RE.match(str(start_raw or ""))
    end_match = _QUIET_HOURS_RE.match(str(end_raw or ""))
    if not start_match or not end_match:
        return False
    start = int(start_match.group(1)) * 60 + int(start_match.group(2))
    end = int(end_match.group(1)) * 60 + int(end_match.group(2))
    current = (now or datetime.now(UTC).time())
    minutes = current.hour * 60 + current.minute
    if start == end:
        return False  # a zero-length window mutes nothing
    if start < end:
        return start <= minutes < end
    return minutes >= start or minutes < end  # overnight window


def should_email_user(user, severity: str | None, now: _time | None = None) -> bool:
    """Check the user's email notification preferences against an event severity."""
    if not getattr(user, "email_notifications_enabled", True):
        return False
    if in_quiet_hours(user, now) and str(severity or "").lower() != "critical":
        return False  # quiet hours hold everything below critical
    minimum = SEVERITY_RANK.get(
        str(getattr(user, "notify_min_severity", "low") or "low").lower(), 1
    )
    rank = SEVERITY_RANK.get(str(severity or "").lower())
    if rank is None:
        return True  # unknown severities are never suppressed
    return rank >= minimum


def is_kind_muted(user, kind: str) -> bool:
    """True when the user muted this notification kind."""
    return kind in (getattr(user, "muted_kinds", None) or [])


def should_email_event(user, kind: str, severity: str | None, now: _time | None = None) -> bool:
    """Decide whether an investigation event (case assignment, escalation,
    SLA breach) goes out by email: muted kinds and quiet hours suppress it."""
    if is_kind_muted(user, kind):
        return False
    return should_email_user(user, severity, now)
