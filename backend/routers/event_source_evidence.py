"""Current owned source metadata and retained event coverage, not live sensor health."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import EventSource, SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/sources/{source_id}/recorded-evidence')
async def recorded_source_evidence(
    source_id: int, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    source = (await db.execute(select(EventSource).where(
        EventSource.id == source_id, EventSource.user_id == current_user.id))).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail='Event source not found')
    owned = [SecurityEvent.user_id == current_user.id, SecurityEvent.source_id == source.id]
    fields = ('source_ip', 'dest_ip', 'hostname', 'username', 'domain')
    coverage = [func.coalesce(func.sum(case((func.length(func.trim(getattr(SecurityEvent, field))) > 0, 1),
                                           else_=0)), 0) for field in fields]
    aggregate = (await db.execute(select(func.count(SecurityEvent.id), func.min(SecurityEvent.timestamp),
        func.max(SecurityEvent.timestamp), func.min(SecurityEvent.created_at), func.max(SecurityEvent.created_at),
        *coverage).where(*owned))).one()
    groups = {}
    for name in ('severity', 'event_type', 'source_type', 'processed'):
        column = getattr(SecurityEvent, name)
        result = (await db.execute(select(column, func.count(SecurityEvent.id)).where(*owned)
            .group_by(column).order_by(column.asc().nullsfirst()).limit(1001))).all()
        if len(result) > 1000:
            raise HTTPException(status_code=422, detail='Recorded source evidence exceeds 1000 distinct labels '
                                'in a group. No partial profile was returned.')
        groups[name] = [{'value': value, 'count': count} for value, count in result]
    keys = ('id', 'name', 'source_type', 'status', 'event_count', 'last_event_at', 'created_at')
    return {'source': {key: getattr(source, key) for key in keys}, 'retained_event_count': aggregate[0],
            'first_observed_at': aggregate[1], 'last_observed_at': aggregate[2],
            'first_created_at': aggregate[3], 'last_created_at': aggregate[4],
            'nonempty_field_counts': dict(zip(fields, aggregate[5:], strict=True)), 'groups': groups,
            'retrieved_at': datetime.now(UTC),
            'scope': 'Current source record and all currently retained events owned by this account with this '
                     'exact source ID, independent of event-list filters. Aggregates are separate current reads, '
                     'not an atomic capture or complete ingestion history. Source counter and source last-event '
                     'metadata are recorded separately and may differ from retained records. Observation timestamps '
                     'can be old or future-dated; created timestamps are saved insertion metadata, '
                     'not verified arrival. '
                     'Field coverage counts nonempty text after database space trimming, '
                     'not valid entities or identities. '
                     'Stored status does not prove connectivity, liveness or detection coverage. No source config, '
                     'credentials, payloads, scans, AI calls or state changes.'}
