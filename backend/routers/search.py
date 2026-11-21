"""Owned record search for the command palette and full search workspace."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case as sql_case
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()
PER_GROUP_LIMIT = 5
SearchKind = Literal['alerts', 'cases', 'assets', 'events', 'incidents']


def _search_statements(q: str, user_id: int):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail='Search needs at least two non-padding characters')
    like = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'

    def matches(*columns):
        return or_(*(column.ilike(like, escape='\\') for column in columns))

    asset_scope = [Asset.user_id == user_id, matches(Asset.name, Asset.vendor, Asset.product)]
    event_terms = [matches(*(getattr(SecurityEvent, field) for field in (
        'signature', 'signature_id', 'hostname', 'source_ip', 'dest_ip', 'category', 'event_type',
    )))]
    if query.isascii() and query.isdigit() and 0 < int(query) <= 2147483647:
        event_terms.append(SecurityEvent.id == int(query))
    severity = sql_case({'low': 0, 'medium': 1, 'high': 2, 'critical': 3}, value=Alert.severity, else_=-1)
    incidents = (select(Asset.id, Asset.name, func.count(Alert.id).label('alert_count'),
                        func.max(severity).label('severity_rank'))
                 .join(Alert, Alert.asset_id == Asset.id)
                 .where(*asset_scope, Alert.user_id == user_id,
                        Alert.status.in_(('pending', 'sent', 'acknowledged')))
                 .group_by(Asset.id, Asset.name).having(func.count(Alert.id) >= 2)
                 .order_by(Asset.name, Asset.id))
    return query, {
        'alerts': select(Alert).where(Alert.user_id == user_id,
            matches(Alert.title, Alert.description, Alert.cve_id)).order_by(Alert.created_at.desc(), Alert.id.desc()),
        'cases': select(Case).where(Case.user_id == user_id,
            matches(Case.title, Case.summary)).order_by(Case.created_at.desc(), Case.id.desc()),
        'assets': select(Asset).where(*asset_scope).order_by(Asset.name, Asset.id),
        'events': select(SecurityEvent).where(SecurityEvent.user_id == user_id, or_(*event_terms))
            .order_by(SecurityEvent.timestamp.desc(), SecurityEvent.id.desc()),
        'incidents': incidents,
    }


def _search_record(kind: str, row):
    if kind == 'incidents':
        return {'asset_id': row.id, 'asset_name': row.name, 'alert_count': row.alert_count,
                'max_severity': {0: 'low', 1: 'medium', 2: 'high', 3: 'critical'}.get(row.severity_rank, 'unknown')}
    if kind == 'events':
        return {field: getattr(row, field) for field in (
            'id', 'signature', 'event_type', 'severity', 'timestamp', 'source_ip', 'dest_ip',
        )}
    if kind == 'assets':
        return {field: getattr(row, field) for field in ('id', 'name', 'vendor', 'asset_type')}
    severity = row.severity.value if hasattr(row.severity, 'value') else str(row.severity)
    return {'id': row.id, 'title': row.title, 'status': row.status, 'severity': severity}


async def _search_rows(db, kind, statement):
    result = await db.execute(statement)
    rows = result.all() if kind == 'incidents' else result.scalars().all()
    return [_search_record(kind, row) for row in rows]


@router.get('/')
async def global_search(
    q: str = Query(..., min_length=2, max_length=200),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Bounded previews with total matches; raw event payloads are never searched or returned."""
    query, statements = _search_statements(q, current_user.id)
    data = {'query': query}
    totals = {}
    for kind, statement in statements.items():
        totals[kind] = (await db.execute(select(func.count()).select_from(
            statement.order_by(None).subquery(),
        ))).scalar_one()
        data[kind] = await _search_rows(db, kind, statement.limit(PER_GROUP_LIMIT))
    return {'success': True, 'data': {**data, 'totals': totals, 'preview_limit': PER_GROUP_LIMIT}}


@router.get('/records')
async def search_records(
    q: str = Query(..., min_length=2, max_length=200), kind: SearchKind = 'alerts',
    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Search all matching current owned records, one bounded group page at a time."""
    query, statements = _search_statements(q, current_user.id)
    totals = {}
    for group, statement in statements.items():
        totals[group] = (await db.execute(select(func.count()).select_from(
            statement.order_by(None).subquery(),
        ))).scalar_one()
    return {'query': query, 'kind': kind, 'page': page, 'size': size, 'total': totals[kind],
            'totals': totals, 'retrieved_at': datetime.now(UTC),
            'records': await _search_rows(db, kind, statements[kind].offset((page - 1) * size).limit(size))}
