"""Exact task deletion review, including access retained by its assignee."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseTask, CaseWatcher
from backend.models.user import User


async def task_deletion_review(db, case, actor, task_id, *, lock=False):
    if actor.id not in {case.user_id, case.assigned_to_id}:
        raise HTTPException(status_code=403, detail='Only checklist managers may delete a task')
    query = select(CaseTask).where(CaseTask.id == task_id, CaseTask.case_id == case.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    task = (await db.execute(query)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=409, detail='This exact task is no longer present')
    person, tasks, watched = None, [], False
    if task.assignee_id is not None:
        query = select(User).where(User.id == task.assignee_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        person = (await db.execute(query)).scalar_one_or_none()
        if person is None:
            raise HTTPException(status_code=409, detail='Exact assigned account could not be verified')
        query = select(CaseTask).where(CaseTask.case_id == case.id, CaseTask.assignee_id == person.id,
                                      CaseTask.id != task.id).order_by(CaseTask.id).limit(501)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        tasks = (await db.execute(query)).scalars().all()
        if len(tasks) > 500:
            raise HTTPException(status_code=409, detail='Complete retained task access exceeds review limit')
        query = select(CaseWatcher).where(CaseWatcher.case_id == case.id, CaseWatcher.user_id == person.id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        watch = (await db.execute(query)).scalar_one_or_none()
        watched = watch is not None
    reasons = []
    if person is not None:
        if person.id == case.user_id:
            reasons.append('Investigation owner')
        if person.id == case.assigned_to_id:
            reasons.append('Investigation assignee')
        if watched:
            reasons.append('Watcher')
        if tasks:
            reasons.append('Other assigned checklist tasks')
    source = {'case_id': case.id, 'owner_id': case.user_id, 'assigned_to_id': case.assigned_to_id,
              'title': case.title, 'status': case.status, 'severity': case.severity,
              'task': {key: getattr(task, key) for key in ['id', 'title', 'done', 'due_date', 'completed_at',
                  'assignee_id', 'position', 'created_by_id', 'created_at', 'due_soon_notified_at',
                  'overdue_notified_at']},
              'assignee': None if person is None else {key: getattr(person, key) for key in
                  ['id', 'email', 'full_name', 'role', 'org_id', 'is_active']},
              'retained_access_reasons': reasons,
              'other_assigned_tasks': [{'id': row.id, 'title': row.title, 'done': row.done} for row in tasks]}
    encoded = json.dumps({'review': source, 'account': {key: getattr(actor, key) for key in
        ['id', 'email', 'org_id', 'role', 'is_active']}}, sort_keys=True, separators=(',', ':'), default=str)
    return source | {'reviewed_fingerprint': hashlib.sha256(encoded.encode()).hexdigest()}
