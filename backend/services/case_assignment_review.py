"""Exact investigation and recipient evidence for reviewed assignment."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.user import User


async def assignment_review(db, case, owner, target_id, *, lock=False):
    ids = sorted({value for value in [owner.id, case.assigned_to_id, target_id] if value is not None})
    query = select(User).where(User.id.in_(ids)).order_by(User.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    users = {row.id: row for row in (await db.execute(query)).scalars().all()}
    owner = users.get(owner.id)
    target = users.get(target_id)
    if owner is None or not owner.is_active:
        raise HTTPException(status_code=403, detail="Current account is unavailable")
    if target_id is not None and (target is None or not target.is_active or (
        target.org_id != owner.org_id if owner.org_id is not None else target_id != owner.id
    )):
        raise HTTPException(status_code=400, detail="Assignee must be an active member of your organization")
    if case.assigned_to_id == target_id:
        raise HTTPException(status_code=409, detail="The investigation already has this assignment")

    def person(row):
        return None if row is None else {"id": row.id, "email": row.email, "full_name": row.full_name,
                                         "role": row.role, "org_id": row.org_id, "is_active": row.is_active}

    source = {"schema_version": 1, "case_id": case.id, "owner_id": case.user_id,
              "title": case.title, "summary": case.summary, "status": case.status, "severity": case.severity,
              "due_date": case.due_date.isoformat() if case.due_date else None,
              "current_assignee_id": case.assigned_to_id, "current_assignee": person(users.get(case.assigned_to_id)),
              "target_id": target_id, "target": person(target), "owner": person(owner)}
    digest = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {**source, "reviewed_fingerprint": digest}
