"""Read-only, fingerprint-bound comparison of one retained hunt row with its current event."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.detection_rule import HuntSession
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.hunt_retained_review import (
    field_comparisons,
    retained_fingerprint,
    selected_retained_row,
)

router = APIRouter()


@router.get('/{session_id}/queries/{query_number}/retained-rows/{row_number}/current-evidence')
async def current_retained_event(
    session_id: Annotated[int, Path(ge=1, le=2147483647)],
    query_number: Annotated[int, Path(ge=1, le=3)],
    row_number: Annotated[int, Path(ge=1, le=100)],
    fingerprint: str = Query(..., min_length=64, max_length=64, pattern='^[0-9a-f]{64}$'),
    expected_event_id: int = Query(..., ge=1, le=2147483647),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    session = (await db.execute(select(HuntSession).where(
        HuntSession.id == session_id, HuntSession.user_id == current_user.id))).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail='Hunt session not found')
    token = retained_fingerprint(session.id, session.hypothesis, session.result_data)
    if token is None or token != fingerprint:
        raise HTTPException(status_code=409,
                            detail='Saved hunt evidence changed or is unsupported. Refresh the saved hunt.')
    try:
        columns, retained = selected_retained_row(session.result_data, query_number, row_number)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if retained['id'] != expected_event_id:
        raise HTTPException(status_code=409, detail='The retained row no longer matches the displayed event ID.')
    current = (await db.execute(select(*(getattr(SecurityEvent, name) for name in columns)).where(
        SecurityEvent.id == retained['id'], SecurityEvent.user_id == current_user.id))).mappings().one_or_none()
    try:
        fields = field_comparisons(columns, retained, current) if current is not None else []
    except ValueError:
        raise HTTPException(status_code=409,
                            detail='Current event values have an unsupported comparison format.') from None
    return {'session_id': session_id, 'query_number': query_number, 'row_number': row_number,
            'event_id': retained['id'], 'fingerprint': token, 'current_available': current is not None,
            'field_count': len(columns), 'fields': fields, 'text_limit': 1000,
            'retrieved_at': datetime.now(UTC),
            'scope': 'One retained row from the exact loaded saved hunt query and a current owned event with that ID. '
                     'Only selected serialized field values are compared, before display text shortening. '
                     'Equal selected values do not prove the whole event is unchanged or still matches the query, '
                     'or confirms a threat. Missing current evidence does not prove deletion. '
                     'These are separate reads, not an immutable or atomic snapshot. '
                     'No original hunt query, AI call, scan or action is rerun; no state changes.'}
