"""Cases router — investigation cases created by AI triage agent."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.case import (
    Case, CaseAlert, CaseEvent, CaseTimeline, AgentRun,
    CaseResponse, CaseListResponse, CaseDetailResponse,
    TimelineEntryResponse, AgentRunResponse,
)
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/", response_model=CaseListResponse)
async def list_cases(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    severity: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List investigation cases with pagination and filters."""
    skip = (page - 1) * size

    query = select(Case).where(Case.user_id == current_user.id)
    count_q = select(func.count(Case.id)).where(Case.user_id == current_user.id)

    if severity:
        query = query.filter(Case.severity == severity)
        count_q = count_q.filter(Case.severity == severity)
    if status_filter:
        query = query.filter(Case.status == status_filter)
        count_q = count_q.filter(Case.status == status_filter)

    total = (await db.execute(count_q)).scalar_one()
    query = query.order_by(Case.created_at.desc()).offset(skip).limit(size)
    cases = (await db.execute(query)).scalars().all()

    # Enrich with counts
    case_responses = []
    for case in cases:
        alert_count = (await db.execute(
            select(func.count(CaseAlert.id)).where(CaseAlert.case_id == case.id)
        )).scalar_one()
        event_count = (await db.execute(
            select(func.count(CaseEvent.id)).where(CaseEvent.case_id == case.id)
        )).scalar_one()

        resp = CaseResponse.model_validate(case)
        resp.alert_count = alert_count
        resp.event_count = event_count
        case_responses.append(resp)

    return CaseListResponse(cases=case_responses, total=total, page=page, size=size)


@router.get("/{case_id}", response_model=CaseDetailResponse)
async def get_case(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get case detail with timeline."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # Get timeline
    timeline = (await db.execute(
        select(CaseTimeline)
        .where(CaseTimeline.case_id == case_id)
        .order_by(CaseTimeline.timestamp)
    )).scalars().all()

    # Get counts
    alert_count = (await db.execute(
        select(func.count(CaseAlert.id)).where(CaseAlert.case_id == case_id)
    )).scalar_one()
    event_count = (await db.execute(
        select(func.count(CaseEvent.id)).where(CaseEvent.case_id == case_id)
    )).scalar_one()

    resp = CaseDetailResponse.model_validate(case)
    resp.alert_count = alert_count
    resp.event_count = event_count
    resp.timeline = [TimelineEntryResponse.model_validate(t) for t in timeline]
    return resp


@router.patch("/{case_id}")
async def update_case(
    case_id: int,
    status_update: Optional[str] = None,
    severity: Optional[str] = None,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update case status or severity."""
    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if status_update:
        case.status = status_update
    if severity:
        case.severity = severity

    await db.commit()
    return {"success": True, "message": "Case updated"}


@router.post("/auto-triage")
async def auto_triage(
    hours_back: int = Query(24, ge=1, le=168),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Run the AI triage agent on recent unprocessed alerts and events."""
    from backend.services.agents.triage import TriageAgent

    agent = TriageAgent(db=db, user_id=current_user.id)
    result = await agent.execute(hours_back=hours_back)

    return {"success": True, "data": result}


@router.get("/{case_id}/alerts")
async def get_case_alerts(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get alerts linked to a case."""
    from backend.models.alert import Alert

    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(Alert)
        .join(CaseAlert, CaseAlert.alert_id == Alert.id)
        .where(CaseAlert.case_id == case_id)
    )
    alerts = result.scalars().all()
    return [a.to_dict() for a in alerts]


@router.get("/{case_id}/events")
async def get_case_events(
    case_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get security events linked to a case."""
    from backend.models.security_event import SecurityEvent

    case = (await db.execute(
        select(Case).where(Case.id == case_id, Case.user_id == current_user.id)
    )).scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    result = await db.execute(
        select(SecurityEvent)
        .join(CaseEvent, CaseEvent.event_id == SecurityEvent.id)
        .where(CaseEvent.case_id == case_id)
        .order_by(SecurityEvent.timestamp)
    )
    events = result.scalars().all()
    return [{"id": e.id, "timestamp": e.timestamp.isoformat(), "event_type": e.event_type,
             "severity": e.severity, "source_ip": e.source_ip, "dest_ip": e.dest_ip,
             "signature": e.signature, "category": e.category} for e in events]


# --- Agent Ledger Endpoints ---

@router.get("/agents/runs", response_model=list[AgentRunResponse])
async def list_agent_runs(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all agent runs for the current user."""
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.user_id == current_user.id)
        .order_by(AgentRun.started_at.desc())
        .limit(50)
    )
    return result.scalars().all()
