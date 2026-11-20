"""Exact owned event evidence, preserving stored JSON number precision as text."""
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.security_event import EventSource, SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/{event_id}/evidence')
async def get_event_evidence(
    event_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    event = (await db.execute(select(SecurityEvent).where(
        SecurityEvent.id == event_id, SecurityEvent.user_id == current_user.id,
    ))).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail='Security event not found')
    source = None
    if event.source_id is not None:
        source = (await db.execute(select(EventSource).where(
            EventSource.id == event.source_id, EventSource.user_id == current_user.id,
        ))).scalar_one_or_none()
    fields = ('id', 'source_id', 'timestamp', 'event_type', 'severity', 'signature', 'signature_id', 'category',
              'source_ip', 'source_port', 'dest_ip', 'dest_port', 'protocol', 'action', 'hostname', 'username',
              'domain', 'url', 'user_agent', 'source_type', 'processed', 'created_at')
    record = {field: getattr(event, field) for field in fields}
    record.update({field: str(getattr(event, field)) if getattr(event, field) is not None else None
                   for field in ('bytes_in', 'bytes_out')})
    return {'event': record, 'source_state': 'owned' if source else 'unavailable' if event.source_id else 'not_linked',
            'source': {'id': source.id, 'name': source.name, 'source_type': source.source_type,
                       'status': source.status, 'last_event_at': source.last_event_at} if source else None,
            'raw_payload_json': json.dumps(event.raw_data, ensure_ascii=False, sort_keys=True, indent=2)
            if event.raw_data is not None else None, 'retrieved_at': datetime.now(UTC).isoformat()}
