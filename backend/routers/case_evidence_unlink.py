"""Review exact owned case/evidence relationships before removing links, never evidence."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import CaseAlert, CaseEvent, CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.case_evidence_review import EvidenceKind as Kind
from backend.services.case_evidence_review import evidence_pair_preview as _preview
from backend.services.case_evidence_review import owned_evidence_record as _owned_record
from backend.services.reviewed_case_link import ExactEvidenceId, owned_existing_case

router = APIRouter()


class ReviewedEvidenceUnlink(BaseModel):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    reason: str = Field(min_length=1, max_length=1000)
    model_config = {'extra': 'forbid'}


@router.get('/{case_id}/evidence/{kind}/{record_id}/unlink-preview')
async def preview_evidence_unlink(
    case_id: ExactEvidenceId, kind: Kind, record_id: ExactEvidenceId,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = await owned_existing_case(db, current_user.id, case_id)
    record = await _owned_record(db, current_user.id, kind, record_id)
    return await _preview(db, case, record, kind)


@router.post('/{case_id}/evidence/{kind}/{record_id}/unlink')
async def unlink_reviewed_evidence(
    case_id: ExactEvidenceId, kind: Kind, record_id: ExactEvidenceId, payload: ReviewedEvidenceUnlink,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail='A nonempty unlink reason is required')
    case = await owned_existing_case(db, current_user.id, case_id, lock=True)
    record = await _owned_record(db, current_user.id, kind, record_id, lock=True)
    preview = await _preview(db, case, record, kind)
    if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
        raise HTTPException(status_code=409, detail='Case, evidence or owned links changed. Refresh and review again.')
    if preview['link_count']:
        link = CaseAlert if kind == 'alert' else CaseEvent
        reference = link.alert_id if kind == 'alert' else link.event_id
        await db.execute(delete(link).where(link.case_id == case.id, reference == record.id))
        content = f'{kind.title()} #{record.id} unlinked after exact evidence review. Reason: {reason}'
        db.add(CaseTimeline(case_id=case.id, entry_type=kind, source='human', user_id=current_user.id,
                            content=content,
                            metadata_json={'kind': kind, 'record_id': record.id, 'reason': reason,
                                           'removed_link_rows': preview['link_count'],
                                           'reviewed_fingerprint': payload.reviewed_fingerprint}))
        add_audit_log(db, user_id=current_user.id, action='case_evidence_unlinked',
                      target_type='case', target_id=case.id, detail=content)
        await db.commit()
    return {'case_id': case.id, 'kind': kind, 'record_id': record.id, 'unlinked': True,
            'removed_link_rows': preview['link_count'], 'reviewed_fingerprint': payload.reviewed_fingerprint}
