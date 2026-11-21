"""Paged read-only evidence linked to a visible investigation, without orphan-reference disclosure."""
import csv
import io
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.case import CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.case_visibility import visible_cases
from backend.services.csv_export import spreadsheet_safe_row

router = APIRouter()
EXPORT_LIMIT = 10000


@router.get('/{case_id}/linked-evidence')
async def get_linked_case_evidence(
    case_id: int, kind: Literal['alert', 'event'], search: str = Query('', max_length=200),
    severity: Literal['all', 'info', 'low', 'medium', 'high', 'critical'] = 'all',
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case, model, link, reference, conditions, query = await _evidence_scope(
        db, case_id, current_user, kind, search, severity)
    available = (await db.execute(select(func.count()).select_from(model).where(
        model.id.in_(select(reference).where(link.case_id == case_id)), model.user_id == case.user_id))).scalar_one()
    linked = (await db.execute(select(func.count(func.distinct(reference)))
                               .where(link.case_id == case_id))).scalar_one()
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


async def _evidence_scope(db, case_id, current_user, kind, search, severity):
    case = (await db.execute(visible_cases(case_id, current_user))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    model, link, reference = (Alert, CaseAlert, CaseAlert.alert_id) if kind == 'alert' else (
        SecurityEvent, CaseEvent, CaseEvent.event_id)
    references = select(reference).where(link.case_id == case_id)
    # Case collaborators retain existing case visibility, but malformed legacy links cannot
    # disclose another owner's original evidence through an unrelated case.
    conditions = [model.id.in_(references), model.user_id == case.user_id]
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
    return case, model, link, reference, conditions, query


@router.get('/{case_id}/linked-evidence/export')
async def export_linked_case_evidence(
    case_id: int, kind: Literal['alert', 'event'], search: str = Query('', max_length=200),
    severity: Literal['all', 'info', 'low', 'medium', 'high', 'critical'] = 'all',
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    case, model, _, _, conditions, query = await _evidence_scope(
        db, case_id, current_user, kind, search, severity)
    timestamp = model.created_at if kind == 'alert' else model.timestamp
    rows = (await db.execute(select(model).where(*conditions)
        .order_by(timestamp.desc().nulls_last(), model.id.desc()).limit(EXPORT_LIMIT + 1))).scalars().all()
    if len(rows) > EXPORT_LIMIT:
        raise HTTPException(status_code=413, detail=(
            f'Too many linked records to export. Narrow the filters to at most {EXPORT_LIMIT} records; '
            'no partial file was generated.'))
    retrieved_at = datetime.now(UTC).isoformat()
    fields = ('title', 'description', 'status', 'cve_id', 'created_at') if kind == 'alert' else (
        'signature', 'event_type', 'timestamp', 'source_ip', 'dest_ip', 'hostname', 'category', 'processed')
    buffer = io.StringIO(newline='')
    writer = csv.writer(buffer)
    writer.writerow(['case_id', 'case_title', 'evidence_kind', 'applied_search', 'applied_severity',
                     'exported_at', 'record_count', 'record_id', 'severity', *fields])
    for row in rows:
        level = row.severity.value if hasattr(row.severity, 'value') else row.severity
        values = [getattr(row, field) for field in fields]
        values = [value.isoformat() if isinstance(value, datetime) else value for value in values]
        writer.writerow(spreadsheet_safe_row([case.id, case.title, kind, query, severity,
                                              retrieved_at, len(rows), row.id, level, *values]))
    return Response(content=buffer.getvalue(), media_type='text/csv', headers={
        'Content-Disposition': f'attachment; filename=case-{case.id}-linked-{kind}s.csv',
        'Cache-Control': 'no-store', 'X-Evidence-Record-Count': str(len(rows)),
    })


@router.get('/{case_id}/evidence-overlap')
async def compare_case_evidence(
    case_id: int, other_case_id: int = Query(..., ge=1, le=2147483647),
    kind: Literal['alert', 'event'] = 'alert',
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Compare exact accessible evidence IDs, never infer a shared incident from text."""
    source = (await db.execute(visible_cases(case_id, current_user))).scalar_one_or_none()
    other = (await db.execute(visible_cases(other_case_id, current_user))).scalar_one_or_none()
    if source is None or other is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    if case_id == other_case_id:
        raise HTTPException(status_code=422, detail='Choose a different investigation to compare.')
    model, link, reference = (Alert, CaseAlert, CaseAlert.alert_id) if kind == 'alert' else (
        SecurityEvent, CaseEvent, CaseEvent.event_id)

    def available_ids(case):
        return select(model.id).where(model.user_id == case.user_id,
                                      model.id.in_(select(reference).where(link.case_id == case.id)))

    source_ids, other_ids = available_ids(source), available_ids(other)
    source_count = (await db.execute(select(func.count()).select_from(source_ids.subquery()))).scalar_one()
    other_count = (await db.execute(select(func.count()).select_from(other_ids.subquery()))).scalar_one()
    shared = [model.id.in_(source_ids), model.id.in_(other_ids)]
    shared_count = (await db.execute(select(func.count()).select_from(model).where(*shared))).scalar_one()
    timestamp = model.created_at if kind == 'alert' else model.timestamp
    rows = (await db.execute(select(model).where(*shared)
        .order_by(timestamp.desc().nulls_last(), model.id.desc())
        .offset((page - 1) * size).limit(size))).scalars().all()
    records = [{'id': row.id, 'label': row.title if kind == 'alert' else row.signature,
                'severity': row.severity.value if hasattr(row.severity, 'value') else row.severity,
                'recorded_at': getattr(row, 'created_at' if kind == 'alert' else 'timestamp'),
                'can_open_original': row.user_id == current_user.id} for row in rows]
    return {'case_id': source.id, 'case_title': source.title,
            'other_case_id': other.id, 'other_case_title': other.title, 'kind': kind,
            'source_count': source_count, 'other_count': other_count, 'shared_count': shared_count,
            'source_only_count': source_count - shared_count, 'other_only_count': other_count - shared_count,
            'page': page, 'size': size, 'records': records, 'retrieved_at': datetime.now(UTC).isoformat(),
            'scope': 'Exact shared saved record IDs, not text similarity or proof of the same incident. '
                     'Counts include only currently retrievable records belonging to each investigation owner. '
                     'Unavailable or wrong-owner links are excluded. No links or investigation state were changed.'}
