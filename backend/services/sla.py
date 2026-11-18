"""Severity-based SLA due dates for investigations (cases).

When a user enables SLA due dates, every new investigation automatically
gets a target close date derived from its severity. A periodic breach
check notifies the owner once an open investigation passes its due date.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from backend.models.audit_log import AuditLog
from backend.models.case import Case
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.email_alert import email_service
from backend.services.notification_prefs import should_email_event

logger = logging.getLogger(__name__)

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


_ACTIVE_CASE_STATUSES = ("open", "investigating")


async def notify_breached_slas(db) -> int:
    """Notify owners once per investigation that passed its SLA due date.

    Marks each breached case so repeat runs do not re-notify; moving or
    clearing the due date resets the marker. Returns the number of
    notifications sent.
    """
    today = datetime.now(UTC).date()
    breached = (await db.execute(
        select(Case).where(
            Case.due_date.isnot(None),
            Case.due_date < today,
            Case.status.in_(_ACTIVE_CASE_STATUSES),
            Case.sla_breach_notified_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(UTC)
    for case in breached:
        days_overdue = (today - case.due_date).days
        db.add(Notification(
            user_id=case.user_id,
            kind="case_sla_breached",
            title=f"Investigation overdue: {case.title}",
            body=(
                f"SLA target {case.due_date.isoformat()} passed "
                f"{days_overdue} day{'s' if days_overdue != 1 else ''} ago. "
                f"Severity: {case.severity}."
            ),
            link=f"/app/cases/{case.id}",
        ))
        db.add(AuditLog(
            user_id=case.user_id, action="case_sla_breached",
            target_type="case", target_id=case.id,
            detail=f"Investigation {days_overdue}d past its SLA due date {case.due_date.isoformat()}",
        ))
        case.sla_breach_notified_at = now
    if breached:
        await db.commit()
        logger.info("Sent %d SLA breach notifications", len(breached))
        for case in breached:
            user = await db.get(User, case.user_id)
            if user is not None and should_email_event(user, "case_sla_breached", case.severity):
                await email_service.send_investigation_event(
                    user,
                    title=f"Investigation overdue: {case.title}",
                    body=(
                        f"Investigation #{case.id} passed its SLA target "
                        f"{case.due_date.isoformat()}. Severity: {case.severity}."
                    ),
                    link_path=f"/app/cases/{case.id}",
                )
    return len(breached)
