"""Bind a timeline-note edit to the complete saved note and exact proposed text."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseTimeline


async def note_edit_review(db, case, actor, entry_id, content, *, lock=False):
    content = content.strip()
    if not content:
        raise HTTPException(status_code=422, detail='Note must not be blank')
    query = select(CaseTimeline).where(CaseTimeline.case_id == case.id, CaseTimeline.id == entry_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    entry = (await db.execute(query)).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail='Note not found')
    if entry.entry_type != 'note':
        raise HTTPException(status_code=422, detail='Only investigator notes can be edited')
    note = {'id': entry.id, 'content': entry.content, 'source': entry.source, 'user_id': entry.user_id,
            'timestamp': entry.timestamp.isoformat() if entry.timestamp else None, 'metadata_json': entry.metadata_json}
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'status': case.status,
              'severity': case.severity, 'assigned_to_id': case.assigned_to_id, 'note': note, 'content': content}
    digest = hashlib.sha256(json.dumps({'review': source, 'account': {key: getattr(actor, key) for key in
        ['id', 'email', 'org_id', 'role', 'is_active']}}, sort_keys=True, separators=(',', ':'),
        default=str).encode()).hexdigest()
    return source | {'reviewed_fingerprint': digest}
