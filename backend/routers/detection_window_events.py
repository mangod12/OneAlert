"""Current event evidence in one owned saved detection receipt's timestamp window."""
import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import AgentRun, AgentStep
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()
_LIMITS = {'event_type': 64, 'severity': 64, 'signature': 300, 'source_ip': 128, 'dest_ip': 128}


def receipt_window(text, run_id):
    """Never replace missing/invalid saved bounds with a default or wider scope."""
    try:
        if not isinstance(text, str) or len(text) > 1500000:
            raise ValueError
        saved = json.loads(text)
        if (not isinstance(saved, dict) or saved.get('format') != 'onealert-detection-review'
                or type(saved.get('version')) is not int or saved['version'] != 1
                or type(saved.get('run_id')) is not int or saved['run_id'] != run_id
                or type(saved.get('total_events')) is not int
                or not 0 <= saved['total_events'] <= 2**53 - 1):
            raise ValueError
        start, end = (datetime.fromisoformat(saved[key]) for key in ('window_from', 'window_until'))
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        if start.year < 1970 or end.year > 2100 or not timedelta(0) < end - start <= timedelta(hours=168):
            raise ValueError
        return start, end, saved['total_events']
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        raise HTTPException(status_code=409,
                            detail='This saved detection receipt has no supported bounded event window.') from None


@router.get('/agents/runs/{run_id}/detection-receipts/{step_id}/events')
async def detection_window_events(
    run_id: Annotated[int, Path(ge=1, le=2147483647)],
    step_id: Annotated[int, Path(ge=1, le=2147483647)],
    page: int = Query(1, ge=1, le=2147483647), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    owned = (await db.execute(select(AgentRun.id).where(
        AgentRun.id == run_id, AgentRun.user_id == current_user.id,
        AgentRun.agent_type == 'detect'))).scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=404, detail='Saved detection receipt not found')
    text = (await db.execute(select(AgentStep.output_summary).where(
        AgentStep.id == step_id, AgentStep.run_id == run_id,
        AgentStep.action == 'detection_review_receipt',
        AgentStep.tool_used == 'bounded_detection_review'))).scalar_one_or_none()
    if text is None:
        raise HTTPException(status_code=404, detail='Saved detection receipt not found')
    start, end, recorded_total = receipt_window(text, run_id)
    filters = [SecurityEvent.user_id == current_user.id,
               SecurityEvent.timestamp >= start, SecurityEvent.timestamp <= end]
    total = (await db.execute(select(func.count(SecurityEvent.id)).where(*filters))).scalar_one()
    columns = ('id', 'timestamp', *_LIMITS)
    rows = (await db.execute(select(*(getattr(SecurityEvent, key) for key in columns)).where(*filters)
        .order_by(SecurityEvent.timestamp.asc(), SecurityEvent.id.asc())
        .offset((page - 1) * size).limit(size))).mappings().all()
    records = []
    for original in rows:
        row = dict(original)
        stamp = row['timestamp']
        row['timestamp'] = stamp.replace(tzinfo=UTC) if stamp.tzinfo is None else stamp.astimezone(UTC)
        row['shortened_fields'] = []
        for key, limit in _LIMITS.items():
            if isinstance(row[key], str) and len(row[key]) > limit:
                row[key] = row[key][:limit]
                row['shortened_fields'].append(key)
        records.append(row)
    return {'run_id': run_id, 'step_id': step_id, 'window_from': start, 'window_until': end,
            'recorded_total_events': recorded_total, 'total': total, 'page': page, 'size': size,
            'records': records, 'retrieved_at': datetime.now(UTC),
            'scope': 'Current owned event records in this exact saved detection receipt window. '
                     'Both timestamp bounds are inclusive. '
                     'This is not the original run snapshot, proof the model reviewed these records, '
                     'or evidence that every row relates to a retained finding. '
                     'Count and page are separate reads and may change. Bounded saved metadata only; '
                     'no raw payload, provider call, scan, execution or state change.'}
