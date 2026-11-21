"""Read-only, globally paged chronology of retrievable linked alert and event records."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.case_visibility import visible_cases

router = APIRouter()


@router.get('/{case_id}/evidence-chronology')
async def evidence_chronology(
    case_id: int, kind: Literal['all', 'alert', 'event'] = 'all',
    severity: Literal['all', 'info', 'low', 'medium', 'high', 'critical'] = 'all',
    order: Literal['oldest', 'newest'] = 'oldest',
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = (await db.execute(visible_cases(case_id, current_user))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    queries, counts = [], {}
    for name, model, link, reference, timestamp, label in [
        ('alert', Alert, CaseAlert, CaseAlert.alert_id, Alert.created_at, Alert.title),
        ('event', SecurityEvent, CaseEvent, CaseEvent.event_id, SecurityEvent.timestamp, SecurityEvent.signature),
    ]:
        conditions = [model.user_id == case.user_id,
                      model.id.in_(select(reference).where(link.case_id == case_id))]
        available = (await db.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
        linked = (await db.execute(select(func.count(func.distinct(reference)))
                                   .where(link.case_id == case_id))).scalar_one()
        counts[name] = {'available': available, 'unavailable': max(0, linked - available)}
        if kind not in ('all', name):
            continue
        if severity != 'all':
            conditions.append(model.severity == severity)
        queries.append(select(literal(name).label('kind'), model.id.label('id'), label.label('label'),
                              model.severity.label('severity'), timestamp.label('recorded_at'),
                              model.user_id.label('owner_id')).where(*conditions))
    combined = union_all(*queries).subquery()
    total = (await db.execute(select(func.count()).select_from(combined))).scalar_one()
    sort = combined.c.recorded_at.asc() if order == 'oldest' else combined.c.recorded_at.desc()
    rows = (await db.execute(select(combined).order_by(sort.nulls_last(), combined.c.kind.asc(),
                            combined.c.id.asc()).offset((page - 1) * size).limit(size))).mappings().all()
    records = [{'kind': row['kind'], 'id': row['id'], 'label': row['label'], 'severity': row['severity'],
                'recorded_at': row['recorded_at'], 'can_open_original': row['owner_id'] == current_user.id}
               for row in rows]
    return {'case_id': case.id, 'kind': kind, 'severity': severity, 'order': order, 'page': page, 'size': size,
            'total': total, 'counts': counts, 'records': records, 'retrieved_at': datetime.now(UTC).isoformat()}
