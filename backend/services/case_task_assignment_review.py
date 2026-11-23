"""Review exact checklist assignment, new access and retained former access."""
import hashlib
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select

from backend.models.case import CaseTask, CaseWatcher
from backend.models.user import User
from backend.services.case_task_deletion_review import task_deletion_review


class TaskAssignmentProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assignee_id: StrictInt | None = Field(ge=1)


async def task_assignment_review(db, case, actor, task_id, assignee_id, *, lock=False):
    source = await task_deletion_review(db, case, actor, task_id, lock=lock)
    if source['task']['assignee_id'] == assignee_id:
        raise HTTPException(status_code=409, detail='The task already has this assignment')
    target, settings, reasons = None, None, []
    if assignee_id is not None:
        query = select(User).where(User.id == assignee_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        person = (await db.execute(query)).scalar_one_or_none()
        if person is None or not person.is_active or (
            actor.org_id is None and person.id != actor.id
        ) or (actor.org_id is not None and person.org_id != actor.org_id):
            raise HTTPException(status_code=400, detail='Assignee must be an active member of your organization')
        target = {key: getattr(person, key) for key in ['id', 'email', 'full_name', 'role', 'org_id', 'is_active']}
        settings = {key: getattr(person, key) for key in ['email_notifications_enabled', 'notify_min_severity',
            'muted_kinds', 'quiet_hours_start', 'quiet_hours_end', 'slack_webhook_url', 'webhook_url']}
        if person.id == case.user_id:
            reasons.append('Investigation owner')
        if person.id == case.assigned_to_id:
            reasons.append('Investigation assignee')
        query = select(CaseWatcher).where(CaseWatcher.case_id == case.id, CaseWatcher.user_id == person.id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        if (await db.execute(query)).scalar_one_or_none() is not None:
            reasons.append('Watcher')
        query = select(CaseTask).where(CaseTask.case_id == case.id, CaseTask.assignee_id == person.id).order_by(
            CaseTask.id).limit(501)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        tasks = (await db.execute(query)).scalars().all()
        if len(tasks) > 500:
            raise HTTPException(status_code=409, detail='Complete assigned task access exceeds review limit')
        if tasks:
            reasons.append('Other assigned checklist tasks')
    public = source | {'proposed_assignee_id': assignee_id, 'proposed_assignee': target,
        'target_existing_access_reasons': reasons, 'grants_investigation_access': target is not None and not reasons,
        'assignment_notification': target is not None and assignee_id != actor.id}
    digest = hashlib.sha256(json.dumps({'review': public, 'notification_settings': settings}, sort_keys=True,
        separators=(',', ':'), default=str).encode()).hexdigest()
    return public | {'reviewed_fingerprint': digest}
