"""Auto-assignment of new alerts across an organization.

When a user opts in, each new alert their pipeline creates is assigned to
the active org member with the fewest open assigned alerts (ties break to
the lowest user id, so behaviour is deterministic).
"""

import logging

from sqlalchemy import func, select

from backend.models.alert import Alert
from backend.models.user import User

logger = logging.getLogger(__name__)

_ACTIVE_ALERT_STATUSES = ("pending", "sent", "acknowledged")


async def auto_assignee_id(db, user) -> int | None:
    """Return the least-loaded active org member's id, or None when not applicable."""
    if not getattr(user, "auto_assign_new_alerts", False):
        return None
    if not isinstance(user.org_id, int) or isinstance(user.org_id, bool):
        return None
    members = (await db.execute(
        select(User).where(User.org_id == user.org_id, User.is_active == True)  # noqa: E712
    )).scalars().all()
    if len(members) < 2:
        return None
    member_ids = [m.id for m in members]
    counts = (await db.execute(
        select(Alert.assigned_to_id, func.count())
        .where(
            Alert.assigned_to_id.in_(member_ids),
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
        )
        .group_by(Alert.assigned_to_id)
    )).all()
    load = dict(counts)
    best = min(members, key=lambda m: (load.get(m.id, 0), m.id))
    return best.id
