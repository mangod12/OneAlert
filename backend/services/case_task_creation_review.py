"""Bind an unassigned task addition to the exact saved checklist and account."""
import hashlib
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, StrictStr
from sqlalchemy import select

from backend.models.case import CaseTask


class TaskCreationProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: StrictStr


async def task_creation_review(db, case, actor, title, *, lock=False):
    if actor.id not in {case.user_id, case.assigned_to_id}:
        raise HTTPException(status_code=403, detail='Only checklist managers may add tasks')
    title = title.strip()
    if not title or len(title) > 300:
        raise HTTPException(status_code=422, detail='Task title must contain 1 to 300 characters')
    query = select(CaseTask).where(CaseTask.case_id == case.id).order_by(CaseTask.position, CaseTask.id).limit(501)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    tasks = (await db.execute(query)).scalars().all()
    if len(tasks) > 500:
        raise HTTPException(status_code=409, detail='Complete checklist exceeds review limit')
    source = {'case_id': case.id, 'owner_id': case.user_id, 'assigned_to_id': case.assigned_to_id,
              'title': case.title, 'status': case.status, 'severity': case.severity,
              'proposed_title': title, 'task_count': len(tasks),
              'next_position': max((task.position for task in tasks), default=-1) + 1}
    evidence = {'review': source, 'account': {key: getattr(actor, key) for key in
                ['id', 'email', 'org_id', 'role', 'is_active']},
                'tasks': [{key: getattr(task, key) for key in
                ['id', 'title', 'done', 'due_date', 'assignee_id', 'position', 'completed_at']} for task in tasks]}
    encoded = json.dumps(evidence, sort_keys=True, separators=(',', ':'), default=str).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    return source | {'reviewed_fingerprint': digest}
