"""Review exact owned case/evidence relationships before removing links, never evidence."""
import hashlib
import json
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.reviewed_case_link import ExactEvidenceId, owned_existing_case

router = APIRouter()
Kind = Literal['alert', 'event']


class ReviewedEvidenceUnlink(BaseModel):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    reason: str = Field(min_length=1, max_length=1000)
    model_config = {'extra': 'forbid'}


async def _owned_record(db, user_id, kind, record_id, *, lock=False):
    model = Alert if kind == 'alert' else SecurityEvent
    if lock and db.bind.dialect.name == 'sqlite':
        values = {'id': model.id}
        if hasattr(model, 'updated_at'):
            values['updated_at'] = model.updated_at
        await db.execute(update(model).where(model.id == record_id, model.user_id == user_id).values(**values))
    statement = select(model).where(model.id == record_id, model.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    record = (await db.execute(statement)).scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail='Owned evidence record not found')
    return record


async def _preview(db, case, record, kind):
    link = CaseAlert if kind == 'alert' else CaseEvent
    reference = link.alert_id if kind == 'alert' else link.event_id
    count = (await db.execute(select(func.count(link.id)).where(
        link.case_id == case.id, reference == record.id))).scalar_one()
    other = (await db.execute(select(func.count(func.distinct(Case.id))).join(link).where(
        reference == record.id, Case.id != case.id, Case.user_id == case.user_id))).scalar_one()
    full_record = {column.name: getattr(record, column.name) for column in record.__table__.columns}
    digest = hashlib.sha256(json.dumps(full_record, sort_keys=True, default=str,
                                     separators=(',', ':')).encode()).hexdigest()
    proposal = {'case': {field: getattr(case, field) for field in (
        'id', 'title', 'summary', 'status', 'severity', 'due_date', 'closed_at')},
        'kind': kind, 'record': {'id': record.id,
            'label': record.title if kind == 'alert' else record.signature or record.event_type,
            'severity': record.severity,
            'recorded_at': record.created_at if kind == 'alert' else record.timestamp,
            'processing_label': record.status if kind == 'alert' else record.processed},
        'record_fingerprint': digest, 'link_count': count, 'other_owned_case_count': other}
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


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
