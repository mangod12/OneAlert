"""Weekly on-call rotation for an organization.

Admins set an ordered list of org members; the rotation hands off every
7 days from the anchor date. While a rotation is set, auto-assignment
(new alerts, escalated investigations, and the bulk "Auto: least
loaded" action) goes to whoever is on call instead of balancing across
the whole org.
"""

import logging
from datetime import UTC, date, datetime

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
