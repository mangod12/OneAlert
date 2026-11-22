"""Anchor-based exact recorded-field pivots, never inferred attribution or network activity."""
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/{event_id}/recorded-neighbors')
async def recorded_event_neighbors(
    event_id: int, field: Literal['source_ip', 'dest_ip', 'hostname', 'username', 'domain'],
    hours: int = Query(24, ge=1, le=168),
    page: int = Query(1, ge=1, le=2147483647), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    anchor = (await db.execute(select(SecurityEvent).where(
        SecurityEvent.id == event_id, SecurityEvent.user_id == current_user.id))).scalar_one_or_none()
    if anchor is None:
        raise HTTPException(status_code=404, detail='Security event not found')
    value = getattr(anchor, field)
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=422, detail='The selected anchor field has no recorded nonempty text.')
    timestamp = anchor.timestamp
    timestamp = timestamp.replace(tzinfo=UTC) if timestamp.tzinfo is None else timestamp.astimezone(UTC)
    try:
        start, before = timestamp - timedelta(hours=hours), timestamp + timedelta(hours=hours)
    except OverflowError:
        raise HTTPException(status_code=422, detail='The anchor timestamp cannot support this time window.') from None
    filters = [SecurityEvent.user_id == current_user.id, SecurityEvent.id != anchor.id,
               getattr(SecurityEvent, field) == value, SecurityEvent.timestamp >= start,
               SecurityEvent.timestamp < before]
    total = (await db.execute(select(func.count(SecurityEvent.id)).where(*filters))).scalar_one()
    rows = (await db.execute(select(SecurityEvent).where(*filters)
        .order_by(SecurityEvent.timestamp.asc(), SecurityEvent.id.asc())
        .offset((page - 1) * size).limit(size))).scalars().all()
    keys = ('id', 'timestamp', 'event_type', 'severity', 'signature', 'source_ip', 'dest_ip',
            'hostname', 'username', 'domain', 'source_type')
    return {'event_id': event_id, 'field': field, 'value': value, 'anchor_timestamp': timestamp,
            'hours': hours, 'started_at': start, 'ended_before': before, 'page': page, 'size': size,
            'total': total, 'records': [{key: getattr(row, key) for key in keys} for row in rows],
            'retrieved_at': datetime.now(UTC),
            'scope': 'Exact same-field equality using the current owned anchor record value. '
                     'No case folding, address canonicalization, DNS lookup or cross-field matching. '
                     'UTC window is anchor time minus/plus the requested hours, inclusive start and exclusive end. '
                     'Anchor itself excluded. Saved timestamps do not establish causality or ingestion order. '
                     'Shared text can name different systems or people; no attribution, common incident, compromise '
                     'or absence of activity is inferred. Current records may change between reads or pages, not a '
                     'frozen snapshot. No external system is contacted, no AI is called and no state is changed.'}
