"""Analyst notes bound to a currently linked, owned evidence revision, without notifications."""
import hashlib
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.case_evidence_review import EvidenceKind, evidence_pair_preview, owned_evidence_record
from backend.services.reviewed_case_link import ExactEvidenceId, owned_existing_case

router = APIRouter()


class ReviewedEvidenceNote(BaseModel):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    content: str = Field(min_length=1, max_length=2000)
    model_config = {'extra': 'forbid'}


def _note_scope(case_id, kind, record_id):
    metadata = CaseTimeline.metadata_json
    return (CaseTimeline.case_id == case_id, CaseTimeline.entry_type == 'note', CaseTimeline.source == 'human',
            metadata['kind'].as_string() == 'reviewed_evidence_note',
            metadata['schema_version'].as_integer() == 1, metadata['case_id'].as_integer() == case_id,
            metadata['record_kind'].as_string() == kind, metadata['record_id'].as_integer() == record_id)


async def _preview(db, case, record, kind, *, lock=False):
    base = await evidence_pair_preview(db, case, record, kind)
    scope = _note_scope(case.id, kind, record.id)
    count = (await db.execute(select(func.count(CaseTimeline.id)).where(*scope))).scalar_one()
    statement = select(CaseTimeline).where(*scope).order_by(CaseTimeline.id.desc()).limit(5)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    notes = (await db.execute(statement)).scalars().all()
    proposal = {key: value for key, value in base.items() if key != 'reviewed_fingerprint'}
    proposal.update(note_count=count, recent_notes=[{'id': entry.id, 'content': entry.content,
                    'timestamp': entry.timestamp, 'author_id': entry.user_id,
                    'record_fingerprint': entry.metadata_json.get('record_fingerprint')} for entry in notes])
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


@router.get('/{case_id}/evidence/{kind}/{record_id}/note-preview')
async def preview_evidence_note(
    case_id: ExactEvidenceId, kind: EvidenceKind, record_id: ExactEvidenceId,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = await owned_existing_case(db, current_user.id, case_id)
    record = await owned_evidence_record(db, current_user.id, kind, record_id)
    return await _preview(db, case, record, kind)


@router.post('/{case_id}/evidence/{kind}/{record_id}/notes')
async def add_reviewed_evidence_note(
    case_id: ExactEvidenceId, kind: EvidenceKind, record_id: ExactEvidenceId, payload: ReviewedEvidenceNote,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail='A nonempty evidence note is required')
    case = await owned_existing_case(db, current_user.id, case_id, lock=True)
    record = await owned_evidence_record(db, current_user.id, kind, record_id, lock=True)
    preview = await _preview(db, case, record, kind, lock=True)
    if not preview['link_count']:
        raise HTTPException(status_code=409, detail='The evidence is no longer linked. Review the current case.')
    # The case lock serializes same-case notes. Repeating identical text for this exact evidence
    # revision returns the saved note instead of creating a duplicate, including uncertain retries.
    existing = (await db.execute(select(CaseTimeline).where(
        *_note_scope(case.id, kind, record.id), CaseTimeline.user_id == current_user.id,
        CaseTimeline.content == content,
        CaseTimeline.metadata_json['record_fingerprint'].as_string() == preview['record_fingerprint']
    ).order_by(CaseTimeline.id.desc()).limit(1).with_for_update()
        .execution_options(populate_existing=True))).scalar_one_or_none()
    if existing is not None:
        entry, created = existing, False
    else:
        if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
            raise HTTPException(status_code=409, detail=(
                'Case, evidence, links or recorded notes changed. Review again.'))
        label = str(preview['record']['label'] or '')
        entry = CaseTimeline(case_id=case.id, entry_type='note', source='human', user_id=current_user.id,
            content=content, metadata_json={'kind': 'reviewed_evidence_note', 'schema_version': 1,
                'case_id': case.id, 'record_kind': kind, 'record_id': record.id,
                'record_fingerprint': preview['record_fingerprint'],
                'reviewed_fingerprint': payload.reviewed_fingerprint,
                'record_snapshot': {'label_at_review': label[:500], 'label_truncated': len(label) > 500,
                    'severity': preview['record']['severity'],
                    'recorded_at': str(preview['record']['recorded_at']) if preview['record']['recorded_at'] else None,
                    'processing_label': preview['record']['processing_label']}})
        db.add(entry)
        await db.flush()
        # Deliberately exclude the note text and payload from audit detail. No mention processing,
        # watcher sharing, notification, AI, linking or source/status changes happen here.
        add_audit_log(db, user_id=current_user.id, action='case_evidence_note_added',
                      target_type='case', target_id=case.id,
                      detail=f'Evidence note #{entry.id} saved for {kind} #{record.id} after exact revision review')
        await db.commit()
        created = True
    return {'case_id': case.id, 'kind': kind, 'record_id': record.id, 'note_id': entry.id,
            'content': entry.content, 'created': created, 'reviewed_fingerprint': payload.reviewed_fingerprint,
            'record_fingerprint': preview['record_fingerprint']}
