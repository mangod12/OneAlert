"""Bounded UTC distributions of saved observation time, never telemetry arrival or liveness."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import EventSource, SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()
SCOPE = ('Exact owned source ID and saved observation timestamps, inclusive start and exclusive end. '
         'UTC buckets describe currently retained rows, not verified arrival, activity, connectivity or '
         'detection coverage. Empty buckets mean no retained matching rows in this read, not no activity. '
         'Counts and pages are separate current reads and can change. No payloads, source configuration, '
         'external lookup, AI call or state change.')


def window(started_at: datetime, ended_before: datetime, hours: int = 1):
    try:
        start, end = started_at.astimezone(UTC), ended_before.astimezone(UTC)
    except (OverflowError, ValueError):
        raise HTTPException(status_code=422, detail='Observation window cannot be represented in UTC.') from None
    if start.year < 1970 or end.year > 2100 or end <= start or end - start > timedelta(days=31):
        raise HTTPException(status_code=422, detail='Use an increasing UTC window within 1970-2100, at most 31 days.')
    if any(value.minute or value.second or value.microsecond or int(value.timestamp()) % (hours * 3600)
           for value in (start, end)):
        raise HTTPException(status_code=422, detail='Window boundaries must align to the selected UTC bucket hours.')
    return start, end


async def owned_source(source_id: int, user: User, db: AsyncSession):
    source = (await db.execute(select(EventSource.id).where(
        EventSource.id == source_id, EventSource.user_id == user.id))).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail='Event source not found')


@router.get('/sources/{source_id}/recorded-timeline')
async def recorded_source_timeline(
    source_id: Annotated[int, Path(ge=1, le=2147483647)], started_at: AwareDatetime, ended_before: AwareDatetime,
    bucket_hours: Literal['1', '6', '24'] = '1',
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    await owned_source(source_id, current_user, db)
    hours = int(bucket_hours)
    start, end = window(started_at, ended_before, hours)
    seconds = hours * 3600
    bucket = func.floor(func.extract('epoch', SecurityEvent.timestamp) / seconds)
    result = (await db.execute(select(bucket, func.count(SecurityEvent.id)).where(
        SecurityEvent.user_id == current_user.id, SecurityEvent.source_id == source_id,
        SecurityEvent.timestamp >= start, SecurityEvent.timestamp < end).group_by(bucket))).all()
    counts = {int(key): count for key, count in result}
    rows = []
    cursor = start
    while cursor < end:
        before = cursor + timedelta(hours=hours)
        rows.append({'started_at': cursor, 'ended_before': before,
                     'count': counts.get(int(cursor.timestamp()) // seconds, 0)})
        cursor = before
    return {'source_id': source_id, 'started_at': start, 'ended_before': end,
            'bucket_hours': hours, 'total': sum(row['count'] for row in rows),
            'buckets': rows, 'retrieved_at': datetime.now(UTC), 'scope': SCOPE}


@router.get('/sources/{source_id}/recorded-window-events')
async def recorded_source_window_events(
    source_id: Annotated[int, Path(ge=1, le=2147483647)], started_at: AwareDatetime, ended_before: AwareDatetime,
    page: int = Query(1, ge=1, le=2147483647), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    await owned_source(source_id, current_user, db)
    start, end = window(started_at, ended_before)
    filters = [SecurityEvent.user_id == current_user.id, SecurityEvent.source_id == source_id,
               SecurityEvent.timestamp >= start, SecurityEvent.timestamp < end]
    total = (await db.execute(select(func.count(SecurityEvent.id)).where(*filters))).scalar_one()
    keys = ('id', 'timestamp', 'event_type', 'severity', 'signature', 'source_ip', 'dest_ip',
            'hostname', 'source_type', 'processed')
    rows = (await db.execute(select(*(getattr(SecurityEvent, key) for key in keys)).where(*filters)
        .order_by(SecurityEvent.timestamp.asc(), SecurityEvent.id.asc())
        .offset((page - 1) * size).limit(size))).mappings().all()
    return {'source_id': source_id, 'started_at': start, 'ended_before': end, 'total': total,
            'page': page, 'size': size, 'records': [dict(row) for row in rows],
            'retrieved_at': datetime.now(UTC), 'scope': SCOPE}
