"""Severity-based SLA due dates for investigations (cases).

When a user enables SLA due dates, every new investigation automatically
gets a target close date derived from its severity.
"""

from datetime import UTC, date, datetime, timedelta

_SLA_FIELD_BY_SEVERITY = {
    "critical": "sla_days_critical",
    "high": "sla_days_high",
    "medium": "sla_days_medium",
    "low": "sla_days_low",
    "info": "sla_days_info",
}


def sla_due_date(user, severity) -> date | None:
    """Return the SLA due date for a new case, or None when disabled/unknown."""
    if not getattr(user, "sla_due_dates_enabled", False):
        return None
    sev = severity.value if hasattr(severity, "value") else (str(severity) if severity else "")
    field = _SLA_FIELD_BY_SEVERITY.get(sev.lower())
    if field is None:
        return None
    days = getattr(user, field, None)
    if not days or days < 1:
        return None
    return datetime.now(UTC).date() + timedelta(days=days)
