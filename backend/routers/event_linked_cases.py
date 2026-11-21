"""Read owned investigations explicitly linked to an owned saved event."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/{event_id}/linked-investigations')
async def event_linked_investigations(
    event_id: int, status: Literal['all', 'open', 'investigating', 'resolved', 'closed', 'false_positive'] = 'all',
    page: int = Query(1, ge=1, le=2147483647), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    owned = (await db.execute(select(SecurityEvent.id).where(
        SecurityEvent.id == event_id, SecurityEvent.user_id == current_user.id))).scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=404, detail='Security event not found')
    linked = select(CaseEvent.case_id).where(CaseEvent.event_id == event_id)
    owned_scope = [Case.user_id == current_user.id, Case.id.in_(linked)]
    available = (await db.execute(select(func.count(Case.id)).where(*owned_scope))).scalar_one()
    filtered = [*owned_scope, *([Case.status == status] if status != 'all' else [])]
    total = (await db.execute(select(func.count(Case.id)).where(*filtered))).scalar_one()
    rows = (await db.execute(select(Case).where(*filtered).order_by(Case.id.desc())
                            .offset((page - 1) * size).limit(size))).scalars().all()
    keys = ('id', 'title', 'severity', 'status', 'created_at', 'due_date', 'closed_at')
    return {'event_id': event_id, 'status': status, 'page': page, 'size': size, 'total': total,
            'available_count': available, 'records': [{key: getattr(row, key) for key in keys} for row in rows],
            'retrieved_at': datetime.now(UTC),
            'scope': 'Current investigations owned by this account with an explicit saved link to this owned event. '
                     'Each investigation appears once even if old link rows are duplicated. '
                     'Other owners, missing references and their counts are not disclosed. '
                     'A saved link does not verify a common incident, compromise or attribution. '
                     'Counts and rows can change between reads and pages. No links or records are changed.'}
