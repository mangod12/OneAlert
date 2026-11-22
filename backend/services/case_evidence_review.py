"""Current owner-scoped evidence-pair snapshots shared by reviewed case workflows."""
import hashlib
import json
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func, select, update

from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent

EvidenceKind = Literal['alert', 'event']


async def owned_evidence_record(db, user_id, kind, record_id, *, lock=False):
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


async def evidence_pair_preview(db, case, record, kind):
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
