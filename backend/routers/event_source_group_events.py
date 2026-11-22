"""Exact recorded source label drilldown, including missing and empty labels."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import EventSource, SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/sources/{source_id}/group-events')
async def source_recorded_group_events(
    source_id: int, group: Literal['severity', 'event_type', 'source_type', 'processed'],
    value: str | None = Query(None), missing: bool = False,
    page: int = Query(1, ge=1, le=2147483647), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    source = (await db.execute(select(EventSource.id).where(
        EventSource.id == source_id, EventSource.user_id == current_user.id))).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail='Event source not found')
    if missing == (value is not None):
        raise HTTPException(status_code=422, detail='Choose either a missing label or an exact text value, not both.')
    column = getattr(SecurityEvent, group)
    filters = [SecurityEvent.user_id == current_user.id, SecurityEvent.source_id == source_id,
               column.is_(None) if missing else column == value]
    total = (await db.execute(select(func.count(SecurityEvent.id)).where(*filters))).scalar_one()
    rows = (await db.execute(select(SecurityEvent).where(*filters)
                            .order_by(SecurityEvent.timestamp.desc(), SecurityEvent.id.desc())
                            .offset((page - 1) * size).limit(size))).scalars().all()
    keys = ('id', 'timestamp', 'event_type', 'severity', 'signature', 'source_type', 'processed',
            'source_ip', 'dest_ip', 'hostname')
    return {'source_id': source_id, 'group': group, 'value': None if missing else value, 'missing': missing,
            'page': page, 'size': size, 'total': total,
            'records': [{key: getattr(row, key) for key in keys} for row in rows],
            'retrieved_at': datetime.now(UTC),
            'scope': 'Current owned events with this exact owned source ID and exact same recorded label. '
                     'Missing SQL NULL is distinct from empty text. No case folding, wildcard or inferred matching. '
                     'Newest saved observation timestamp then event ID first, not arrival order. Independent of event '
                     'list filters. Source profile counts and these current reads may differ; neither is frozen. '
                     'Labels and timestamps do not prove incident, attribution, live sensor health or no activity. '
                     'Bounded metadata only, no raw payload, source config, AI call, scan or state change.'}
