"""Owner-generated, source-linked briefing drafts with no response side effects."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case, CaseTimeline
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.agents.report import ReportAgent

router = APIRouter()


async def owned_case(db, case_id, user_id):
    case = (await db.execute(select(Case).where(Case.id == case_id, Case.user_id == user_id))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Case not found')
    return case


@router.post('/{case_id}/briefing-drafts')
async def generate_briefing(case_id: int, current_user: User = Depends(get_active_user),
                            db: AsyncSession = Depends(get_async_db)):
    await owned_case(db, case_id, current_user.id)
    agent = ReportAgent(db, current_user.id)
    return {'data': await agent.execute(case_id=case_id)}


@router.get('/{case_id}/briefing-drafts')
async def list_briefings(case_id: int, before_id: int | None = Query(None, ge=1),
                         current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db)):
    await owned_case(db, case_id, current_user.id)
    query = select(CaseTimeline).where(CaseTimeline.case_id == case_id,
        CaseTimeline.entry_type == 'ai_analysis',
        CaseTimeline.metadata_json['format'].as_string() == 'onealert-case-briefing')
    if before_id is not None:
        query = query.where(CaseTimeline.id < before_id)
    rows = (await db.execute(query.order_by(CaseTimeline.id.desc()).limit(6))).scalars().all()
    return {'case_id': case_id, 'records': [{'timeline_id': row.id, 'briefing': row.metadata_json}
                                           for row in rows[:5]],
            'next_before_id': rows[4].id if len(rows) > 5 else None}
