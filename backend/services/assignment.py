"""Auto-assignment of new work across an organization.

When a user opts in, each new alert their pipeline creates and each
investigation auto-escalation opens is assigned to the active org member
with the fewest open assigned items (alerts plus investigations, so one
person does not collect all of both). Ties break to the lowest user id,
so behaviour is deterministic.
"""

import logging

from sqlalchemy import func, select

from backend.models.alert import Alert
from backend.models.case import Case
from backend.models.user import User

logger = logging.getLogger(__name__)

_ACTIVE_ALERT_STATUSES = ("pending", "sent", "acknowledged")
_ACTIVE_CASE_STATUSES = ("open", "investigating")


async def _open_work_loads(db, member_ids: list[int]) -> dict[int, int]:
    """Open assigned alerts + investigations per member."""
    alert_counts = (await db.execute(
        select(Alert.assigned_to_id, func.count())
        .where(
            Alert.assigned_to_id.in_(member_ids),
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
        )
        .group_by(Alert.assigned_to_id)
    )).all()
    case_counts = (await db.execute(
        select(Case.assigned_to_id, func.count())
        .where(
            Case.assigned_to_id.in_(member_ids),
            Case.status.in_(_ACTIVE_CASE_STATUSES),
        )
        .group_by(Case.assigned_to_id)
    )).all()
    load: dict[int, int] = {}
    for assignee_id, count in list(alert_counts) + list(case_counts):
        load[assignee_id] = load.get(assignee_id, 0) + count
    return load


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
    load = await _open_work_loads(db, [m.id for m in members])
    best = min(members, key=lambda m: (load.get(m.id, 0), m.id))
    return best.id
