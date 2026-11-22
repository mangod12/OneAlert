"""Read-only comparison of a saved analyst source reference and its current owned record."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.case_evidence_reference import FIELDS, saved_note_reference
from backend.services.case_evidence_review import evidence_pair_preview, owned_evidence_record
from backend.services.reviewed_case_link import ExactEvidenceId, owned_existing_case

router = APIRouter()


def _snapshot(record):
    label = str(record['label'] or '')
    return {'label_at_review': label[:500], 'label_truncated': len(label) > 500,
            'severity': record['severity'],
            'recorded_at': str(record['recorded_at']) if record['recorded_at'] else None,
            'processing_label': record['processing_label']}




@router.get('/{case_id}/notes/{note_id}/source-comparison')
async def compare_note_source(
    case_id: ExactEvidenceId, note_id: ExactEvidenceId,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = await owned_existing_case(db, current_user.id, case_id)
    note = (await db.execute(select(CaseTimeline).where(
        CaseTimeline.id == note_id, CaseTimeline.case_id == case.id))).scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail='Note not found in owned investigation')
    kind, record_id, saved_fingerprint, saved_snapshot = saved_note_reference(note, case.id)
    result = {'schema_version': 1, 'case_id': case.id, 'note_id': note.id, 'kind': kind, 'record_id': record_id,
              'saved_fingerprint': saved_fingerprint, 'saved_snapshot': saved_snapshot,
              'source_available': False, 'current_fingerprint': None, 'current_snapshot': None,
              'revision_matches': None, 'changed_snapshot_fields': None, 'link_count': None,
              'retrieved_at': datetime.now(UTC)}
    try:
        record = await owned_evidence_record(db, current_user.id, kind, record_id)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        # Missing and no-longer-owned source records are deliberately indistinguishable.
        return result
    current = await evidence_pair_preview(db, case, record, kind)
    snapshot = _snapshot(current['record'])
    result.update(source_available=True, current_fingerprint=current['record_fingerprint'],
                  current_snapshot=snapshot, revision_matches=saved_fingerprint == current['record_fingerprint'],
                  changed_snapshot_fields=[key for key in FIELDS if saved_snapshot[key] != snapshot[key]],
                  link_count=current['link_count'])
    return result
