"""Daily digest email: a morning summary of the investigation queue.

An hourly scheduler job emails each opted-in user at their chosen UTC
hour: open and overdue investigations, plus fresh critical/high alerts
from the last 24 hours. Quiet users with nothing queued get no email.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from backend.models.alert import Alert
from backend.models.case import Case
from backend.models.user import User
from backend.services.email_alert import email_service

logger = logging.getLogger(__name__)

_ACTIVE_CASE_STATUSES = ("open", "investigating")
_URGENT_SEVERITIES = ("critical", "high")


async def build_digest(db, user: User) -> dict:
    """Collect the digest numbers for one user."""
    today = datetime.now(UTC).date()
    since = datetime.now(UTC) - timedelta(hours=24)

    open_count, investigating_count = 0, 0
    status_rows = (await db.execute(
        select(Case.status, func.count()).where(
            Case.user_id == user.id, Case.status.in_(_ACTIVE_CASE_STATUSES),
        ).group_by(Case.status)
    )).all()
    for status, count in status_rows:
        if status == "open":
            open_count = count
        elif status == "investigating":
            investigating_count = count

    overdue = (await db.execute(
        select(Case).where(
            Case.user_id == user.id,
            Case.status.in_(_ACTIVE_CASE_STATUSES),
            Case.due_date.isnot(None),
            Case.due_date < today,
        ).order_by(Case.due_date.asc()).limit(5)
    )).scalars().all()

    new_urgent_alerts = (await db.execute(
        select(func.count()).select_from(Alert).where(
            Alert.user_id == user.id,
            Alert.severity.in_(_URGENT_SEVERITIES),
            Alert.created_at >= since,
        )
    )).scalar_one()

    return {
        "open": open_count,
        "investigating": investigating_count,
        "overdue": [
            {"title": c.title, "due_date": c.due_date.isoformat(), "severity": c.severity}
            for c in overdue
        ],
        "new_urgent_alerts": new_urgent_alerts,
    }


def render_digest(digest: dict) -> str:
    """Render the digest dict as the email body."""
    lines = [
        f"Open investigations: {digest['open']}",
        f"Being investigated: {digest['investigating']}",
        f"New critical/high alerts (24h): {digest['new_urgent_alerts']}",
    ]
    if digest["overdue"]:
        lines.append("")
        lines.append("Overdue investigations:")
        lines.extend(
            f"- {case['title']} (was due {case['due_date']}, {case['severity']})"
            for case in digest["overdue"]
        )
    return "\n".join(lines)


def _is_empty(digest: dict) -> bool:
    return (
        digest["open"] == 0
        and digest["investigating"] == 0
        and digest["new_urgent_alerts"] == 0
        and not digest["overdue"]
    )


async def send_due_digests(db, now: datetime | None = None) -> int:
    """Email the digest to every opted-in user whose digest hour it is.

    Returns the number of digests sent. Users with an empty queue are
    skipped; users with email notifications turned off are skipped too.
    """
    current = now or datetime.now(UTC)
    users = (await db.execute(
        select(User).where(
            User.is_active.is_(True),
            User.digest_enabled.is_(True),
            User.digest_hour_utc == current.hour,
        )
    )).scalars().all()
    sent = 0
    for user in users:
        if not getattr(user, "email_notifications_enabled", True):
            continue
        digest = await build_digest(db, user)
        if _is_empty(digest):
            continue
        delivered = await email_service.send_investigation_event(
            user,
            title="Your daily OneAlert digest",
            body=render_digest(digest),
            link_path="/app/cases",
        )
        if delivered:
            sent += 1
    if sent:
        logger.info("Sent %d daily digests", sent)
    return sent
