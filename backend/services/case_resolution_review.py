"""Bind an investigation's saved context and the exact proposed resolution text."""
import hashlib
import json

from fastapi import HTTPException


def resolution_review(case, owner, resolution):
    if case.status not in {"resolved", "closed", "false_positive"}:
        raise HTTPException(status_code=409, detail='Resolution text review requires a completed investigation')
    resolution = resolution.strip() or None
    if resolution == case.resolution:
        raise HTTPException(status_code=409, detail='The investigation already has this resolution text')
    source = {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title, 'summary': case.summary,
              'status': case.status, 'severity': case.severity,
              'due_date': case.due_date.isoformat() if case.due_date else None,
              'assigned_to_id': case.assigned_to_id, 'resolution': case.resolution,
              'closed_at': case.closed_at.isoformat() if case.closed_at else None,
              'new_resolution': resolution}
    account = {key: getattr(owner, key) for key in ['id', 'email', 'role', 'org_id', 'is_active']}
    digest = hashlib.sha256(json.dumps({'case': source, 'account': account}, sort_keys=True,
                                       separators=(',', ':')).encode()).hexdigest()
    return source | {'reviewed_fingerprint': digest}
