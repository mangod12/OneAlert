"""Owner-only current investigation access, including task-derived visibility."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import Case, CaseTask, CaseWatcher
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get('/{case_id}/access-map')
async def investigation_access_map(case_id: int, current_user: User = Depends(get_active_user),
                                   db: AsyncSession = Depends(get_async_db)):
    case = (await db.execute(select(Case).where(
        Case.id == case_id, Case.user_id == current_user.id))).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    watches = (await db.execute(select(CaseWatcher).where(
        CaseWatcher.case_id == case.id).order_by(CaseWatcher.id).limit(501))).scalars().all()
    tasks = (await db.execute(select(CaseTask).where(CaseTask.case_id == case.id,
        CaseTask.assignee_id.is_not(None)).order_by(CaseTask.id).limit(501))).scalars().all()
    if len(watches) > 500 or len(tasks) > 500:
        raise HTTPException(status_code=409, detail='Complete access map exceeds the 500-row source limit')
    ids = {case.user_id} | {w.user_id for w in watches} | {t.assignee_id for t in tasks}
    if case.assigned_to_id is not None:
        ids.add(case.assigned_to_id)
    people = (await db.execute(select(User).where(User.id.in_(sorted(ids))).order_by(User.id))).scalars().all()
    if {u.id for u in people} != ids:
        raise HTTPException(status_code=409, detail='Complete access identity could not be verified')
    watched = {w.user_id for w in watches}
    records = []
    for person in people:
        owned, assigned = person.id == case.user_id, person.id == case.assigned_to_id
        person_tasks = [t for t in tasks if t.assignee_id == person.id]
        reasons = (["Investigation owner"] if owned else []) + (["Investigation assignee"] if assigned else [])
        if person.id in watched:
            reasons.append('Watcher')
        if person_tasks:
            reasons.append('Assigned checklist tasks')
        records.append({'id': person.id, 'email': person.email, 'full_name': person.full_name,
                        'role': person.role, 'org_id': person.org_id, 'is_active': person.is_active,
                        'reasons': reasons, 'can_manage_investigation': owned,
                        'can_manage_checklist': owned or assigned, 'can_add_notes': True,
                        'receives_watcher_updates': person.id in watched,
                        'assigned_tasks': [{'id': t.id, 'title': t.title, 'done': t.done} for t in person_tasks]})
    return {'case_id': case.id, 'owner_id': case.user_id, 'title': case.title,
            'retrieved_at': datetime.now(UTC).isoformat(), 'records': records}
