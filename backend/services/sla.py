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
from backend.services.investigation_notify import notify_investigation_event

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
            if user is not None:
                await notify_investigation_event(
                    user,
                    kind="case_sla_breached",
                    severity=case.severity,
                    title=f"Investigation overdue: {case.title}",
                    body=(
                        f"Investigation #{case.id} passed its SLA target "
                        f"{case.due_date.isoformat()}. Severity: {case.severity}."
                    ),
                    link_path=f"/app/cases/{case.id}",
                )
    return len(breached)


async def notify_due_soon_slas(db) -> int:
    """Warn owners the day before an investigation hits its SLA due date.

    Marks each warned case so repeat runs do not re-notify; moving or
    clearing the due date resets the marker. Returns the number of
    notifications sent.
    """
    today = datetime.now(UTC).date()
    tomorrow = today + timedelta(days=1)
    due_soon = (await db.execute(
        select(Case).where(
            Case.due_date == tomorrow,
            Case.status.in_(_ACTIVE_CASE_STATUSES),
            Case.sla_due_soon_notified_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(UTC)
    for case in due_soon:
        db.add(Notification(
            user_id=case.user_id,
            kind="case_sla_due_soon",
            title=f"Investigation due tomorrow: {case.title}",
            body=f"SLA target {case.due_date.isoformat()} is tomorrow. Severity: {case.severity}.",
            link=f"/app/cases/{case.id}",
        ))
        db.add(AuditLog(
            user_id=case.user_id, action="case_sla_due_soon",
            target_type="case", target_id=case.id,
            detail=f"Investigation reaches its SLA due date {case.due_date.isoformat()} tomorrow",
        ))
        case.sla_due_soon_notified_at = now
    if due_soon:
        await db.commit()
        logger.info("Sent %d SLA due-soon notifications", len(due_soon))
        for case in due_soon:
            user = await db.get(User, case.user_id)
            if user is not None:
                await notify_investigation_event(
                    user,
                    kind="case_sla_due_soon",
                    severity=case.severity,
                    title=f"Investigation due tomorrow: {case.title}",
                    body=(
                        f"Investigation #{case.id} reaches its SLA target "
                        f"{case.due_date.isoformat()} tomorrow. Severity: {case.severity}."
                    ),
                    link_path=f"/app/cases/{case.id}",
                )
    return len(due_soon)


_ACTIVE_ALERT_STATUSES = ("pending", "sent", "acknowledged")


def _alert_sla_recipients(alert) -> list[int]:
    """The owner plus the assignee (when different) own an alert's triage SLA."""
    recipients = [alert.user_id]
    if alert.assigned_to_id is not None and alert.assigned_to_id != alert.user_id:
        recipients.append(alert.assigned_to_id)
    return recipients


async def notify_breached_alert_slas(db) -> int:
    """Notify owner and assignee once per alert that passed its triage due date.

    Marks each breached alert so repeat runs do not re-notify; moving or
    clearing the due date resets the marker. Returns the number of alerts
    that notified.
    """
    from backend.models.alert import Alert

    today = datetime.now(UTC).date()
    breached = (await db.execute(
        select(Alert).where(
            Alert.due_date.isnot(None),
            Alert.due_date < today,
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
            Alert.sla_breach_notified_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(UTC)
    for alert in breached:
        days_overdue = (today - alert.due_date).days
        for recipient_id in _alert_sla_recipients(alert):
            db.add(Notification(
                user_id=recipient_id,
                kind="alert_sla_breached",
                title=f"Alert overdue: {alert.title}",
                body=(
                    f"Triage target {alert.due_date.isoformat()} passed "
                    f"{days_overdue} day{'s' if days_overdue != 1 else ''} ago. "
                    f"Severity: {alert.severity}."
                ),
                link=f"/app/alerts?alert={alert.id}",
            ))
            db.add(AuditLog(
                user_id=recipient_id, action="alert_sla_breached",
                target_type="alert", target_id=alert.id,
                detail=f"Alert {days_overdue}d past its triage due date {alert.due_date.isoformat()}",
            ))
        alert.sla_breach_notified_at = now
    if breached:
        await db.commit()
        logger.info("Sent SLA breach notifications for %d alerts", len(breached))
    return len(breached)


async def notify_due_soon_alert_slas(db) -> int:
    """Warn owner and assignee the day before an alert hits its triage due date.

    Marks each warned alert so repeat runs do not re-notify; moving or
    clearing the due date resets the marker. Returns the number of alerts
    that warned.
    """
    from backend.models.alert import Alert

    today = datetime.now(UTC).date()
    tomorrow = today + timedelta(days=1)
    due_soon = (await db.execute(
        select(Alert).where(
            Alert.due_date == tomorrow,
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
            Alert.sla_due_soon_notified_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(UTC)
    for alert in due_soon:
        for recipient_id in _alert_sla_recipients(alert):
            db.add(Notification(
                user_id=recipient_id,
                kind="alert_sla_due_soon",
                title=f"Alert due tomorrow: {alert.title}",
                body=f"Triage target {alert.due_date.isoformat()} is tomorrow. Severity: {alert.severity}.",
                link=f"/app/alerts?alert={alert.id}",
            ))
            db.add(AuditLog(
                user_id=recipient_id, action="alert_sla_due_soon",
                target_type="alert", target_id=alert.id,
                detail=f"Alert reaches its triage due date {alert.due_date.isoformat()} tomorrow",
            ))
        alert.sla_due_soon_notified_at = now
    if due_soon:
        await db.commit()
        logger.info("Sent SLA due-soon notifications for %d alerts", len(due_soon))
    return len(due_soon)
