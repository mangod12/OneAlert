"""Literal search across owned recorded step summaries, with bounded excerpts and no execution."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import AgentRun, AgentStep
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()
_FIELDS = ('action', 'tool_used', 'input_summary', 'output_summary')


def _excerpt(value: str | None, needle: str) -> dict:
    if value is None:
        return {'text': None, 'shortened': False, 'recorded_length': None}
    # Case-insensitive search can expand Unicode characters. Find a bounded
    # original-text start, rather than use lowercased offsets as original offsets.
    lower = value.lower()
    match = lower.find(needle)
    start = 0
    if match >= 0:
        lowered_prefix = 0
        for index, char in enumerate(value):
            if lowered_prefix >= match:
                start = max(0, index - 100)
                break
            lowered_prefix += len(char.lower())
    text = value[start:start + 500]
    return {'text': text, 'shortened': start > 0 or start + len(text) < len(value),
            'recorded_length': len(value)}


@router.get('/agents/step-search')
async def search_recorded_steps(
    query: str = Query(..., min_length=1, max_length=200),
    field: Literal['all', 'action', 'tool_used', 'input_summary', 'output_summary'] = 'all',
    agent_type: str = Query('', max_length=100), run_status: str = Query('', max_length=100),
    page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Search saved summaries before paging, restricted through the run owner."""
    text = query.strip()
    if not text:
        raise HTTPException(status_code=422, detail='Enter nonempty literal recorded-step search text.')
    needle = text.lower()
    fields = _FIELDS if field == 'all' else (field,)
    conditions = [AgentRun.user_id == current_user.id]
    if agent_type:
        conditions.append(AgentRun.agent_type == agent_type)
    if run_status:
        conditions.append(AgentRun.status == run_status)
    matches = {key: func.lower(func.coalesce(getattr(AgentStep, key), '')).contains(
        needle, autoescape=True) for key in fields}
    conditions.append(or_(*matches.values()))
    joined = AgentStep.__table__.join(AgentRun, AgentStep.run_id == AgentRun.id)
    total = (await db.execute(select(func.count()).select_from(joined).where(*conditions))).scalar_one()
    rows = (await db.execute(select(AgentStep, AgentRun, *matches.values()).select_from(joined)
        .where(*conditions).order_by(
        AgentRun.started_at.desc().nulls_last(), AgentRun.id.desc(), AgentStep.step_number.asc(), AgentStep.id.asc())
        .offset((page - 1) * size).limit(size))).all()
    records = []
    for step, run, *flags in rows:
        matched = [key for key, flag in zip(fields, flags, strict=True) if flag]
        records.append({'step_id': step.id, 'run_id': run.id, 'step_number': step.step_number,
            'agent_type': run.agent_type, 'run_status': run.status, 'run_started_at': run.started_at,
            'matched_fields': matched,
            'excerpts': {key: _excerpt(getattr(step, key), needle) for key in _FIELDS}})
    return {'query': text, 'field': field, 'agent_type': agent_type, 'run_status': run_status,
        'page': page, 'size': size, 'total': total, 'records': records,
        'retrieved_at': datetime.now(UTC).isoformat(), 'excerpt_limit': 500,
        'scope': 'Literal search over saved owned-run step action, tool and input/output summaries, before paging. '
                 'Excerpts are bounded and can omit recorded text. Recorder summaries may already be shortened. '
                 'Run status and tool/action labels do not verify external activity or success. '
                 'Missing results do not establish that activity did not occur. '
                 'No raw transcript, provider error, run result summary or unrecorded activity is searched. '
                 'Current records can change between pages. No agent was started and no state or permissions changed.'}
