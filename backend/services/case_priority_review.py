"""Exact investigation priority and notification audience review."""
import hashlib
import json
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseWatcher
from backend.models.user import User


async def priority_review(db, case, owner, field, value, *, lock=False):
    if field == 'severity':
        if value not in {'info', 'low', 'medium', 'high', 'critical'}:
            raise HTTPException(status_code=422, detail='Invalid investigation severity')
        old = case.severity
    else:
        if value != '':
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError
            except ValueError:
                raise HTTPException(status_code=422, detail='Use an exact ISO date or empty to clear') from None
        old = case.due_date.isoformat() if case.due_date else ''
    if value == old:
        raise HTTPException(status_code=409, detail='This investigation already has the selected priority')
    watcher_query = select(CaseWatcher).where(CaseWatcher.case_id == case.id).order_by(CaseWatcher.id).limit(501)
    if lock:
        watcher_query = watcher_query.with_for_update().execution_options(populate_existing=True)
    watches = (await db.execute(watcher_query)).scalars().all()
    if len(watches) > 500:
        raise HTTPException(status_code=409, detail='Complete notification audience exceeds review limit')
    ids = sorted({row.user_id for row in watches} | {owner.id} | (
        {case.assigned_to_id} if case.assigned_to_id else set()))
    query = select(User).where(User.id.in_(ids)).order_by(User.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    people = (await db.execute(query)).scalars().all()
    rows = [{key: getattr(row, key) for key in ['id', 'email', 'full_name', 'role', 'org_id', 'is_active',
             'email_notifications_enabled', 'notify_min_severity', 'muted_kinds', 'quiet_hours_start',
             'quiet_hours_end', 'slack_webhook_url', 'webhook_url']} for row in people]
    if {row.id for row in people} != set(ids):
        raise HTTPException(status_code=409, detail='Complete notification audience could not be verified')
    # Notification endpoints affect the fingerprint but are never returned to the client.
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'summary': case.summary,
              'status': case.status, 'severity': case.severity,
              'due_date': case.due_date.isoformat() if case.due_date else None,
              'assigned_to_id': case.assigned_to_id, 'field': field, 'value': value,
              'watchers': [{'id': row.id, 'user_id': row.user_id} for row in watches], 'people': rows}
    digest = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()
    return {key: value for key, value in source.items() if key != 'people'} | {
        'recipients': [{key: row[key] for key in ['id', 'email', 'full_name', 'role', 'is_active']}
                       for row in rows if row['id'] != owner.id], 'reviewed_fingerprint': digest}
