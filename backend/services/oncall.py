"""Weekly on-call rotation for an organization.

Admins set an ordered list of org members; the rotation hands off every
7 days from the anchor date. While a rotation is set, auto-assignment
(new alerts, escalated investigations, and the bulk "Auto: least
loaded" action) goes to whoever is on call instead of balancing across
the whole org.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from backend.models.organization import Organization
from backend.models.user import User

logger = logging.getLogger(__name__)


def rotation_member_id(member_ids: list[int], anchor: date, today: date) -> int:
    """Who is on call on `today` for the given rotation."""
    weeks = max((today - anchor).days, 0) // 7
    return member_ids[weeks % len(member_ids)]


async def current_on_call_id(db, org: Organization | None, today: date | None = None) -> int | None:
    """The on-call member's id, or None when no usable rotation is set.

    A rotation pointing only at members who left or went inactive is
    ignored, falling back to whole-org load balancing.
    """
    if org is None or not org.on_call_member_ids or org.on_call_anchor_date is None:
        return None
    today = today or datetime.now(UTC).date()
    member_id = rotation_member_id(org.on_call_member_ids, org.on_call_anchor_date, today)
    member = (await db.execute(
        select(User).where(
            User.id == member_id,
            User.org_id == org.id,
            User.is_active == True,  # noqa: E712
        )
    )).scalar_one_or_none()
    return member.id if member is not None else None


def rotation_coverage(member_ids: list[int], anchor: date, today: date, days: int = 56) -> list[dict]:
    """Compress a bounded UTC-day forecast using the assignment rotation itself.

    The first and last segments may be partial weeks. Before the stored anchor,
    the existing assignment rule keeps the first member, rather than rewinding.
    """
    if not member_ids:
        return []
    segments = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        member_id = rotation_member_id(member_ids, anchor, day)
        if segments and segments[-1]['scheduled_member_id'] == member_id:
            segments[-1]['until_exclusive'] = day + timedelta(days=1)
        else:
            segments.append({'from_date': day, 'until_exclusive': day + timedelta(days=1),
                             'scheduled_member_id': member_id})
    return segments
