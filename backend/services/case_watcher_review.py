"""Exact watcher addition binds the account receiving access to an investigation."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseWatcher
from backend.models.user import User


async def watcher_review(db, case, owner, user_id, *, lock=False):
    query = select(User).where(User.id == user_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    member = (await db.execute(query)).scalar_one_or_none()
    if member is None or not member.is_active or (member.id != owner.id and (
        owner.org_id is None or member.org_id != owner.org_id
    )):
        raise HTTPException(status_code=409, detail='The watcher must be an active member of your organization')
    query = select(CaseWatcher).where(CaseWatcher.case_id == case.id, CaseWatcher.user_id == user_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    if (await db.execute(query)).scalars().first() is not None:
        raise HTTPException(status_code=409, detail='This account already watches the investigation')
    target = {key: getattr(member, key) for key in ['id', 'email', 'full_name', 'role', 'org_id', 'is_active']}
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'summary': case.summary,
              'status': case.status, 'severity': case.severity, 'assigned_to_id': case.assigned_to_id,
              'recipient': target}
    account = {key: getattr(owner, key) for key in ['id', 'email', 'role', 'org_id', 'is_active']}
    digest = hashlib.sha256(json.dumps({'case': source, 'account': account}, sort_keys=True,
                                       separators=(',', ':')).encode()).hexdigest()
    return source | {'reviewed_fingerprint': digest}
