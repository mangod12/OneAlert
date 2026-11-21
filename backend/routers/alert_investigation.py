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
