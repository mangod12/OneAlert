"""Bounded owner-only discovery of saved analyst references to an exact owned record."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case, CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.case_evidence_reference import saved_note_reference
from backend.services.case_evidence_review import owned_evidence_record
from backend.services.reviewed_case_link import ExactEvidenceId

router = APIRouter()
PAGE_SIZE = 20
SCAN_LIMIT = 100
MAX_ID = 9007199254740991


@router.get('/source-notes/{kind}/{record_id}')
async def evidence_analyst_history(
    kind: Literal['alert', 'event'], record_id: ExactEvidenceId,
    before: int | None = Query(None, ge=1, le=MAX_ID),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    await owned_evidence_record(db, current_user.id, kind, record_id)
    metadata = CaseTimeline.metadata_json
    conditions = [Case.user_id == current_user.id, CaseTimeline.entry_type == 'note',
                  CaseTimeline.source == 'human', metadata['kind'].as_string() == 'reviewed_evidence_note',
                  metadata['record_kind'].as_string() == kind,
                  # Compare text, never cast untrusted JSON text to an integer on PostgreSQL.
                  cast(metadata['record_id'].as_string(), String) == str(record_id)]
    if before is not None:
        conditions.append(CaseTimeline.id < before)
    candidates = (await db.execute(select(CaseTimeline, Case.id, Case.title, Case.status, Case.severity)
                                  .join(Case, Case.id == CaseTimeline.case_id).where(*conditions)
                                  .order_by(CaseTimeline.id.desc()).limit(SCAN_LIMIT + 1))).all()
    records, scanned, last = [], 0, None
    for entry, case_id, title, status, severity in candidates[:SCAN_LIMIT]:
        scanned += 1
        last = entry.id
        if not (0 < entry.id <= MAX_ID and 0 < case_id <= MAX_ID):
            continue
        try:
            source_kind, source_id, fingerprint, snapshot = saved_note_reference(entry, case_id)
        except HTTPException as error:
            if error.status_code != 422:
                raise
            continue
        if source_kind != kind or source_id != record_id:
            continue
        text, title = str(entry.content or ''), str(title or '')
        records.append({'note_id': entry.id, 'case_id': case_id, 'case_title': title[:200],
                        'case_title_truncated': len(title) > 200,
                        'case_status': str(status)[:64] if status is not None else None,
                        'case_severity': str(severity)[:64] if severity is not None else None,
                        'note_timestamp': entry.timestamp, 'note_excerpt': text[:500],
                        'note_truncated': len(text) > 500, 'saved_fingerprint': fingerprint,
                        'saved_label': snapshot['label_at_review'], 'label_truncated': snapshot['label_truncated']})
        if len(records) == PAGE_SIZE:
            break
    more = len(candidates) > scanned
    # A non-representable legacy ID cannot be a safe client cursor. Fail closed, not a false final page.
    if more and (last is None or not 0 < last <= MAX_ID):
        raise HTTPException(status_code=422, detail='This historical page has no supported continuation cursor')
    return {'schema_version': 1, 'kind': kind, 'record_id': record_id, 'before': before,
            'page_size': PAGE_SIZE, 'scan_limit': SCAN_LIMIT, 'scanned_count': scanned,
            'excluded_count': scanned - len(records), 'records': records,
            'has_more': more, 'next_before': last if more else None, 'retrieved_at': datetime.now(UTC),
            'scope': 'Only supported historical human source references in investigations currently owned by this '
                     'account, for this currently owned exact source. A saved case link is not required. '
                     'This page is bounded to 20 references and 100 candidate notes. Excluded counts concern only '
                     'unsupported candidates scanned on this page, not other people or all malformed notes. '
                     'A next page may contain no supported references. Descending note IDs are navigation, not '
                     'chronological proof. No full-history total is claimed. Notes, access and case fields can '
                     'change between pages. These are saved application references, not proof of current links, '
                     'unchanged evidence, authenticity or correct interpretation. No record or notification changed.'}
