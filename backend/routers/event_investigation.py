"""Create an owned investigation and its exact event link in one reviewed transaction."""
import hashlib
import json
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case, CaseCreate, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.sla import sla_due_date

router = APIRouter()


class ReviewedEventInvestigation(CaseCreate):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')


async def _owned_event(db, user_id, event_id, *, lock=False):
    # SQLite has no row-level FOR UPDATE. Take its writer lock before reading the proposal.
    # This changes no event evidence and serializes same-database create/link transactions.
    if lock and db.bind.dialect.name == 'sqlite':
        await db.execute(update(SecurityEvent).where(SecurityEvent.id == event_id, SecurityEvent.user_id == user_id)
                         .values(id=SecurityEvent.id))
    statement = select(SecurityEvent).where(SecurityEvent.id == event_id, SecurityEvent.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    event = (await db.execute(statement)).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail='Security event not found')
    return event


async def _preview(db, user, event):
    scope = (Case.user_id == user.id, CaseEvent.event_id == event.id)
    total = (await db.execute(select(func.count(func.distinct(Case.id))).join(CaseEvent).where(*scope))).scalar_one()
    cases = (await db.execute(select(Case).join(CaseEvent).where(*scope).distinct()
                              .order_by(Case.id.desc()).limit(20))).scalars().all()
    fields = ('id', 'timestamp', 'event_type', 'signature', 'severity', 'source_ip', 'dest_ip', 'processed')
    event_record = {field: getattr(event, field) for field in fields}
    # Include all saved event columns in the binding, even fields omitted from this short preview.
    full_event = {column.name: getattr(event, column.name) for column in SecurityEvent.__table__.columns}
    event_digest = hashlib.sha256(json.dumps(full_event, sort_keys=True, default=str,
                                            separators=(',', ':')).encode()).hexdigest()
    due_dates = {severity: due.isoformat() if (due := sla_due_date(user, severity)) else None
                 for severity in ('info', 'low', 'medium', 'high', 'critical')}
    proposal = {'event': event_record, 'event_fingerprint': event_digest,
                'existing_case_count': total,
                'existing_cases': [{'id': case.id, 'title': case.title, 'status': case.status} for case in cases],
                'due_dates': due_dates}
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


@router.get('/{event_id}/investigation-preview')
async def preview_event_investigation(
    event_id: int, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    event = await _owned_event(db, current_user.id, event_id)
    return await _preview(db, current_user, event)


@router.post('/{event_id}/investigations', status_code=201)
async def create_event_investigation(
    event_id: int, payload: ReviewedEventInvestigation,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail='Title must not be blank')
    event = await _owned_event(db, current_user.id, event_id, lock=True)
    preview = await _preview(db, current_user, event)
    if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
        raise HTTPException(status_code=409, detail=(
            'Saved event evidence, linked investigations or SLA dates changed. Refresh and review again.'))
    case = Case(user_id=current_user.id, title=title, summary=(payload.summary or '').strip() or None,
                severity=payload.severity, status='open', created_by='human',
                due_date=sla_due_date(current_user, payload.severity))
    db.add(case)
    await db.flush()
    db.add(CaseEvent(case_id=case.id, event_id=event.id))
    event.processed = 'in_case'
    db.add(CaseTimeline(case_id=case.id, entry_type='event', source='human', user_id=current_user.id,
                        content=f'Investigation opened from saved event #{event.id} by {current_user.email}.',
                        metadata_json={'event_id': event.id, 'reviewed_fingerprint': payload.reviewed_fingerprint}))
    add_audit_log(db, user_id=current_user.id, action='case_created', target_type='case', target_id=case.id,
                  detail=f'Investigation opened and linked to saved event #{event.id} in one transaction')
    await db.commit()
    return {'id': case.id, 'event_id': event.id, 'linked': True,
            'reviewed_fingerprint': payload.reviewed_fingerprint}


ExactEvidenceId = Annotated[int, Path(ge=1, le=9007199254740991)]


class ReviewedExistingInvestigation(BaseModel):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    model_config = {'extra': 'forbid'}


async def _owned_existing_case(db, user_id, case_id, *, lock=False):
    # Match the case-first lock order used by the existing case evidence routes.
    if lock and db.bind.dialect.name == 'sqlite':
        await db.execute(update(Case).where(Case.id == case_id, Case.user_id == user_id)
                         .values(id=Case.id, updated_at=Case.updated_at))
    statement = select(Case).where(Case.id == case_id, Case.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    case = (await db.execute(statement)).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    return case


async def _existing_link_preview(db, event, case):
    linked = (await db.execute(select(CaseEvent.id).where(
        CaseEvent.event_id == event.id, CaseEvent.case_id == case.id).limit(1))).scalar_one_or_none() is not None
    full_event = {column.name: getattr(event, column.name) for column in SecurityEvent.__table__.columns}
    event_digest = hashlib.sha256(json.dumps(full_event, sort_keys=True, default=str,
                                            separators=(',', ':')).encode()).hexdigest()
    proposal = {'event': {field: getattr(event, field) for field in (
        'id', 'timestamp', 'event_type', 'signature', 'severity', 'source_ip', 'dest_ip', 'processed')},
        'case': {field: getattr(case, field) for field in (
            'id', 'title', 'summary', 'severity', 'status', 'due_date', 'closed_at', 'assigned_to_id')},
        'event_fingerprint': event_digest, 'already_linked': linked}
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


@router.get('/{event_id}/existing-investigations/{case_id}/preview')
async def preview_existing_investigation_link(
    event_id: ExactEvidenceId, case_id: ExactEvidenceId,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    event = await _owned_event(db, current_user.id, event_id)
    case = await _owned_existing_case(db, current_user.id, case_id)
    return await _existing_link_preview(db, event, case)


@router.post('/{event_id}/existing-investigations/{case_id}')
async def link_reviewed_existing_investigation(
    event_id: ExactEvidenceId, case_id: ExactEvidenceId, payload: ReviewedExistingInvestigation,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = await _owned_existing_case(db, current_user.id, case_id, lock=True)
    event = await _owned_event(db, current_user.id, event_id, lock=True)
    preview = await _existing_link_preview(db, event, case)
    if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
        raise HTTPException(status_code=409, detail='Event, investigation details or link changed. Review again.')
    if preview['already_linked']:
        return {'case_id': case.id, 'event_id': event.id, 'linked': True, 'created': False,
                'reviewed_fingerprint': payload.reviewed_fingerprint}
    db.add(CaseEvent(case_id=case.id, event_id=event.id))
    event.processed = 'in_case'
    db.add(CaseTimeline(case_id=case.id, entry_type='event', source='human', user_id=current_user.id,
                        content=f'Saved event #{event.id} linked after reviewing the exact event and investigation.',
                        metadata_json={'event_id': event.id, 'reviewed_fingerprint': payload.reviewed_fingerprint}))
    add_audit_log(db, user_id=current_user.id, action='case_event_linked', target_type='case', target_id=case.id,
                  detail=f'Saved event #{event.id} linked after exact event and investigation review')
    await db.commit()
    return {'case_id': case.id, 'event_id': event.id, 'linked': True, 'created': True,
            'reviewed_fingerprint': payload.reviewed_fingerprint}
