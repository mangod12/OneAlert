"""Read-only owner-scoped recorded execution health, not incident or provider health."""
from datetime import UTC, date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import AgentRun
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/agents/recorded-health')
async def recorded_agent_health(
    from_date: date | None = None, before_date: date | None = None,
    agent_type: str = Query('', max_length=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    if from_date is not None and before_date is not None and from_date >= before_date:
        raise HTTPException(status_code=422, detail='The exclusive before date must follow the from date.')
    filters = [AgentRun.user_id == current_user.id]
    if from_date is not None:
        filters.append(AgentRun.started_at >= datetime.combine(from_date, time.min, UTC))
    if before_date is not None:
        filters.append(AgentRun.started_at < datetime.combine(before_date, time.min, UTC))
    if agent_type:
        filters.append(AgentRun.agent_type == agent_type)
    rows = (await db.execute(select(
        AgentRun.agent_type, AgentRun.status, func.count(AgentRun.id),
        func.min(AgentRun.started_at), func.max(AgentRun.started_at),
    ).where(*filters).group_by(AgentRun.agent_type, AgentRun.status)
        .order_by(AgentRun.agent_type, AgentRun.status).limit(1001))).all()
    if len(rows) > 1000:
        raise HTTPException(status_code=413, detail=(
            'More than 1000 agent/status groups. Narrow the dates or agent type.'))
    groups = [{'agent_type': agent, 'status': status, 'count': count,
               'first_started_at': first, 'last_started_at': last} for agent, status, count, first, last in rows]
    running = (await db.execute(select(AgentRun).where(*filters, AgentRun.status == 'running')
        .order_by(AgentRun.started_at.asc().nulls_last(), AgentRun.id.asc()).limit(5))).scalars().all()
    return {'from_date': from_date, 'before_date': before_date, 'agent_type': agent_type,
            'retrieved_at': datetime.now(UTC), 'total': sum(row['count'] for row in groups), 'groups': groups,
            'oldest_running': [{'id': row.id, 'agent_type': row.agent_type, 'started_at': row.started_at}
                               for row in running],
            'scope': 'All current owned ledger runs within the requested UTC start-date window, not the latest 50. '
                     'From is inclusive; before is exclusive. Empty bounds cover all saved start dates. '
                     'Groups count recorded statuses, not verified outcomes, active workers or incident truth. '
                     'Running can be stale; no liveness or hang is inferred. Oldest running examples are a separate '
                     'bounded read of at most five records. Records can change between queries, not an atomic '
                     'snapshot or immutable history. No token, spend, provider availability or task quality '
                     'assessment is made. No agent is started, retried, cancelled or changed.'}
