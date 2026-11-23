"""Bind an investigation's saved context and the exact proposed title and summary."""
import hashlib
import json

from fastapi import HTTPException


def details_review(case, owner, title, summary):
    title, summary = title.strip(), summary.strip() or None
    if not title:
        raise HTTPException(status_code=422, detail='Title must contain text')
    if (title, summary) == (case.title, case.summary):
        raise HTTPException(status_code=409, detail='The investigation already has these details')
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'summary': case.summary,
              'status': case.status, 'severity': case.severity,
              'due_date': case.due_date.isoformat() if case.due_date else None,
              'assigned_to_id': case.assigned_to_id, 'resolution': case.resolution,
              'closed_at': case.closed_at.isoformat() if case.closed_at else None,
              'new_title': title, 'new_summary': summary}
    account = {key: getattr(owner, key) for key in ['id', 'email', 'role', 'org_id', 'is_active']}
    digest = hashlib.sha256(json.dumps({'case': source, 'account': account}, sort_keys=True,
                                       separators=(',', ':')).encode()).hexdigest()
    return source | {'reviewed_fingerprint': digest}
