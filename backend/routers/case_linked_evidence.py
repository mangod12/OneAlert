"""Paged read-only evidence linked to a visible investigation, without orphan-reference disclosure."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.case_visibility import visible_cases

router = APIRouter()


@router.get('/{case_id}/linked-evidence')
async def get_linked_case_evidence(
    case_id: int, kind: Literal['alert', 'event'], search: str = Query('', max_length=200),
    severity: Literal['all', 'info', 'low', 'medium', 'high', 'critical'] = 'all',
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case = (await db.execute(visible_cases(case_id, current_user))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    model, link, reference = (Alert, CaseAlert, CaseAlert.alert_id) if kind == 'alert' else (
        SecurityEvent, CaseEvent, CaseEvent.event_id)
    references = select(reference).where(link.case_id == case_id)
    # Case collaborators retain existing case visibility, but malformed legacy links cannot
    # disclose another owner's original evidence through an unrelated case.
    conditions = [model.id.in_(references), model.user_id == case.user_id]
    available = (await db.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
    linked = (await db.execute(select(func.count(func.distinct(reference)))
                               .where(link.case_id == case_id))).scalar_one()
    query = search.strip()
    if query:
        needle = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        fields = ('title', 'description', 'cve_id') if kind == 'alert' else (
            'signature', 'event_type', 'source_ip', 'dest_ip', 'hostname', 'category')
        terms = [getattr(model, field).ilike(needle, escape='\\') for field in fields]
        if query.isascii() and query.isdigit() and 0 < int(query) <= 2147483647:
            terms.append(model.id == int(query))
        conditions.append(or_(*terms))
    if severity != 'all':
        conditions.append(model.severity == severity)
    total = (await db.execute(select(func.count()).select_from(model).where(*conditions))).scalar_one()
    timestamp = model.created_at if kind == 'alert' else model.timestamp
    rows = (await db.execute(select(model).where(*conditions).order_by(timestamp.desc().nulls_last(), model.id.desc())
                             .offset((page - 1) * size).limit(size))).scalars().all()
    records = []
    for row in rows:
        sev = row.severity.value if hasattr(row.severity, 'value') else row.severity
        fields = ('title', 'description', 'status', 'cve_id', 'created_at') if kind == 'alert' else (
            'signature', 'event_type', 'timestamp', 'source_ip', 'dest_ip', 'hostname', 'category', 'processed')
        record = {field: getattr(row, field) for field in fields}
        record.update(id=row.id, severity=sev, can_open_original=row.user_id == current_user.id)
        records.append(record)
    return {'case_id': case.id, 'case_title': case.title, 'kind': kind, 'search': query, 'severity': severity,
            'page': page, 'size': size, 'total': total, 'available_count': available,
            'unavailable_reference_count': max(0, linked - available), 'records': records,
            'retrieved_at': datetime.now(UTC).isoformat()}
