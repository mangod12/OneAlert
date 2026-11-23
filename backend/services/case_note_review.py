"""Review exact note text, mention recipients and automatic watcher access."""
import hashlib
import json
import re

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseWatcher
from backend.models.user import User


async def note_review(db, case, actor, content, *, lock=False):
    content = content.strip()
    if not content:
        raise HTTPException(status_code=422, detail='Note must not be blank')
    tokens = sorted({token.lower() for token in re.findall(r'@([A-Za-z0-9._-]+)', content)})
    query = select(User).where(User.org_id == actor.org_id, User.is_active == True).order_by(User.id).limit(501)  # noqa: E712
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    members = (await db.execute(query)).scalars().all() if tokens and actor.org_id is not None else []
    if len(members) > 500:
        raise HTTPException(status_code=409, detail='Complete mention audience exceeds review limit')
    query = select(CaseWatcher).where(CaseWatcher.case_id == case.id).order_by(CaseWatcher.id).limit(501)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    watches = (await db.execute(query)).scalars().all()
    if len(watches) > 500:
        raise HTTPException(status_code=409, detail='Complete watcher context exceeds review limit')
    watcher_ids = {row.user_id for row in watches}
    recipients, private, matched = [], [], set()
    can_share = actor.id in (case.user_id, case.assigned_to_id)
    fields = ['id', 'email', 'role', 'org_id', 'is_active', 'email_notifications_enabled',
              'notify_min_severity', 'muted_kinds', 'quiet_hours_start', 'quiet_hours_end',
              'slack_webhook_url', 'webhook_url']
    for member in members:
        token = member.email.split('@', 1)[0].lower()
        if member.id == actor.id or token not in tokens:
            continue
        has_access = member.id in (case.user_id, case.assigned_to_id) or member.id in watcher_ids
        if not has_access and not can_share:
            continue
        matched.add(token)
        recipients.append({'id': member.id, 'email': member.email, 'full_name': member.full_name,
                           'adds_watcher': not has_access})
        private.append({key: getattr(member, key) for key in fields})
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'status': case.status,
              'severity': case.severity, 'assigned_to_id': case.assigned_to_id, 'content': content,
              'acting_account_id': actor.id, 'recipients': recipients,
              'unnotified_tokens': sorted(set(tokens) - matched),
              'watchers': [{'id': row.id, 'user_id': row.user_id} for row in watches]}
    digest = hashlib.sha256(json.dumps({'review': source, 'account': {key: getattr(actor, key) for key in fields},
                                       'notification_settings': private}, sort_keys=True,
                                       separators=(',', ':'), default=str).encode()).hexdigest()
    return {key: value for key, value in source.items() if key != 'watchers'} | {'reviewed_fingerprint': digest}
