"""Create an owned investigation and its exact alert link in one reviewed transaction."""
import hashlib
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseCreate, CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.audit import add_audit_log
from backend.services.reviewed_case_link import (
    ExactEvidenceId,
    ReviewedExistingInvestigation,
    owned_existing_case,
)
from backend.services.sla import sla_due_date

router = APIRouter()


class ReviewedAlertInvestigation(CaseCreate):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')


async def _owned_alert(db, user_id, alert_id, *, lock=False):
    # SQLite has no row-level FOR UPDATE. Take its writer lock before reading the proposal.
    # This changes no alert evidence and serializes same-database create/link transactions.
    if lock and db.bind.dialect.name == 'sqlite':
        await db.execute(update(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
                         .values(id=Alert.id, updated_at=Alert.updated_at))
    statement = select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    alert = (await db.execute(statement)).scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail='Owned alert not found')
    return alert


async def _preview(db, user, alert):
    scope = (Case.user_id == user.id, CaseAlert.alert_id == alert.id)
    total = (await db.execute(select(func.count(func.distinct(Case.id))).join(CaseAlert).where(*scope))).scalar_one()
    cases = (await db.execute(select(Case).join(CaseAlert).where(*scope).distinct()
                              .order_by(Case.id.desc()).limit(20))).scalars().all()
    fields = ('id', 'created_at', 'title', 'description', 'severity', 'status', 'cve_id', 'asset_id')
    alert_record = {field: getattr(alert, field) for field in fields}
    # Include all saved alert columns in the binding, even fields omitted from this short preview.
    full_alert = {column.name: getattr(alert, column.name) for column in Alert.__table__.columns}
    alert_digest = hashlib.sha256(json.dumps(full_alert, sort_keys=True, default=str,
                                            separators=(',', ':')).encode()).hexdigest()
    due_dates = {severity: due.isoformat() if (due := sla_due_date(user, severity)) else None
                 for severity in ('info', 'low', 'medium', 'high', 'critical')}
    proposal = {'alert': alert_record, 'alert_fingerprint': alert_digest,
                'existing_case_count': total,
                'existing_cases': [{'id': case.id, 'title': case.title, 'status': case.status} for case in cases],
                'due_dates': due_dates}
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


@router.get('/{alert_id}/investigation-preview')
async def preview_alert_investigation(
    alert_id: int, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    alert = await _owned_alert(db, current_user.id, alert_id)
    return await _preview(db, current_user, alert)


@router.post('/{alert_id}/investigations', status_code=201)
async def create_alert_investigation(
    alert_id: int, payload: ReviewedAlertInvestigation,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail='Title must not be blank')
    alert = await _owned_alert(db, current_user.id, alert_id, lock=True)
    preview = await _preview(db, current_user, alert)
    if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
        raise HTTPException(status_code=409, detail=(
            'Saved alert evidence, linked investigations or SLA dates changed. Refresh and review again.'))
    case = Case(user_id=current_user.id, title=title, summary=(payload.summary or '').strip() or None,
                severity=payload.severity, status='open', created_by='human',
                due_date=sla_due_date(current_user, payload.severity))
    db.add(case)
    await db.flush()
    db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
    db.add(CaseTimeline(case_id=case.id, entry_type='alert', source='human', user_id=current_user.id,
                        content=f'Investigation opened from saved alert #{alert.id} by {current_user.email}.',
                        metadata_json={'alert_id': alert.id, 'reviewed_fingerprint': payload.reviewed_fingerprint}))
    add_audit_log(db, user_id=current_user.id, action='case_created', target_type='case', target_id=case.id,
                  detail=f'Investigation opened and linked to saved alert #{alert.id} in one transaction')
    await db.commit()
    return {'id': case.id, 'alert_id': alert.id, 'linked': True,
            'reviewed_fingerprint': payload.reviewed_fingerprint}


async def _existing_link_preview(db, alert, case):
    linked = (await db.execute(select(CaseAlert.id).where(
        CaseAlert.alert_id == alert.id, CaseAlert.case_id == case.id).limit(1))).scalar_one_or_none() is not None
    full_alert = {column.name: getattr(alert, column.name) for column in Alert.__table__.columns}
    digest = hashlib.sha256(json.dumps(full_alert, sort_keys=True, default=str,
                                     separators=(',', ':')).encode()).hexdigest()
    ranks = {'info': 0, 'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
    resulting_severity = (alert.severity if not linked and ranks.get(str(alert.severity or '').lower(), -1) >
                          ranks.get(str(case.severity or '').lower(), -1) else case.severity)
    proposal = {'alert': {field: getattr(alert, field) for field in (
        'id', 'created_at', 'title', 'description', 'severity', 'status', 'cve_id', 'asset_id')},
        'case': {field: getattr(case, field) for field in (
            'id', 'title', 'summary', 'severity', 'status', 'due_date', 'closed_at', 'assigned_to_id')},
        'resulting_severity': resulting_severity, 'alert_fingerprint': digest, 'already_linked': linked}
    encoded = json.dumps(proposal, sort_keys=True, default=str, separators=(',', ':'))
    return dict(proposal, reviewed_fingerprint=hashlib.sha256(encoded.encode()).hexdigest())


@router.get('/{alert_id}/existing-investigations/{case_id}/preview')
async def preview_existing_investigation_link(
    alert_id: ExactEvidenceId, case_id: ExactEvidenceId,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    alert = await _owned_alert(db, current_user.id, alert_id)
    case = await owned_existing_case(db, current_user.id, case_id)
    return await _existing_link_preview(db, alert, case)


@router.post('/{alert_id}/existing-investigations/{case_id}')
async def link_reviewed_existing_investigation(
    alert_id: ExactEvidenceId, case_id: ExactEvidenceId, payload: ReviewedExistingInvestigation,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = await owned_existing_case(db, current_user.id, case_id, lock=True)
    alert = await _owned_alert(db, current_user.id, alert_id, lock=True)
    preview = await _existing_link_preview(db, alert, case)
    if not secrets.compare_digest(payload.reviewed_fingerprint, preview['reviewed_fingerprint']):
        raise HTTPException(status_code=409, detail='Alert, investigation details or link changed. Review again.')
    if preview['already_linked']:
        return {'case_id': case.id, 'alert_id': alert.id, 'linked': True, 'created': False,
                'severity': case.severity, 'reviewed_fingerprint': payload.reviewed_fingerprint}
    db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
    db.add(CaseTimeline(case_id=case.id, entry_type='alert', source='human', user_id=current_user.id,
                        content=f'Saved alert #{alert.id} linked after reviewing the exact alert and investigation.',
                        metadata_json={'alert_id': alert.id, 'reviewed_fingerprint': payload.reviewed_fingerprint}))
    if preview['resulting_severity'] != case.severity:
        case.severity = preview['resulting_severity']
        db.add(CaseTimeline(case_id=case.id, entry_type='action', source='human', user_id=current_user.id,
                            content=f'Investigation severity raised to {case.severity} after reviewed alert linking.',
                            metadata_json={'alert_id': alert.id}))
    add_audit_log(db, user_id=current_user.id, action='case_alert_linked', target_type='case', target_id=case.id,
                  detail=f'Saved alert #{alert.id} linked after exact alert, investigation and severity review')
    await db.commit()
    return {'case_id': case.id, 'alert_id': alert.id, 'linked': True, 'created': True,
            'severity': case.severity, 'reviewed_fingerprint': payload.reviewed_fingerprint}
