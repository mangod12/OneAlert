"""Exact watcher removal distinguishes stopping updates from access revocation."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseTask, CaseWatcher
from backend.models.user import User


async def watcher_removal_review(db, case, actor, user_id, *, lock=False):
    if actor.id != case.user_id and actor.id != user_id:
        raise HTTPException(status_code=403, detail='Only the owner may remove another watcher')
    query = select(CaseWatcher).where(CaseWatcher.case_id == case.id, CaseWatcher.user_id == user_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    watch = (await db.execute(query)).scalar_one_or_none()
    query = select(User).where(User.id == user_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    person = (await db.execute(query)).scalar_one_or_none()
    if watch is None or person is None:
        raise HTTPException(status_code=409, detail='This exact watcher is no longer present')
    query = select(CaseTask).where(CaseTask.case_id == case.id,
                                   CaseTask.assignee_id == user_id).order_by(CaseTask.id).limit(501)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    tasks = (await db.execute(query)).scalars().all()
    if len(tasks) > 500:
        raise HTTPException(status_code=409, detail='Complete retained-access task list exceeds review limit')
    reasons = []
    if case.user_id == user_id:
        reasons.append('Investigation owner')
    if case.assigned_to_id == user_id:
        reasons.append('Investigation assignee')
    if tasks:
        reasons.append('Assigned checklist tasks')
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'status': case.status,
              'severity': case.severity, 'assigned_to_id': case.assigned_to_id, 'watcher_id': watch.id,
              'recipient': {key: getattr(person, key) for key in ['id', 'email', 'full_name',
                                                                'role', 'org_id', 'is_active']},
              'retained_access_reasons': reasons,
              'assigned_tasks': [{'id': row.id, 'title': row.title, 'done': row.done} for row in tasks]}
    digest = hashlib.sha256(json.dumps({'review': source, 'account': {key: getattr(actor, key) for key in
        ['id', 'email', 'org_id', 'role', 'is_active']}}, sort_keys=True, separators=(',', ':'),
        default=str).encode()).hexdigest()
    return source | {'reviewed_fingerprint': digest}
