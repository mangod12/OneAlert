"""Hunt router — threat hunting sessions and detection rules."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timezone

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.detection_rule import DetectionRule, HuntSession, DetectionRuleResponse, HuntSessionResponse
from backend.routers.auth import get_active_user

router = APIRouter()


class HuntRequest(BaseModel):
    hypothesis: str


class DetectionRuleCreate(BaseModel):
    name: str
    rule_type: str  # sigma, suricata, yara, sql
    rule_content: str
    description: str | None = None
    mitre_techniques: list | None = None
    confidence: str = "medium"


@router.post("/")
async def start_hunt(
    req: HuntRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Start a threat hunting session with a natural-language hypothesis."""
    from backend.services.agents.hunt import HuntAgent

    # Create session record
    session = HuntSession(
        user_id=current_user.id,
        hypothesis=req.hypothesis,
    )
    db.add(session)
    await db.flush()

    # Run hunt agent
    agent = HuntAgent(db=db, user_id=current_user.id)
    result = await agent.execute(hypothesis=req.hypothesis)

    # Update session
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)
    session.queries_run = len(result.get("query_results", []))
    session.findings_count = sum(r.get("row_count", 0) for r in result.get("query_results", []))
    session.result_data = result.get("query_results")
    session.sigma_rule = result.get("sigma_rule")
    await db.commit()

    return {"success": True, "data": {**result, "session_id": session.id}}


@router.get("/", response_model=list[HuntSessionResponse])
async def list_hunts(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all hunt sessions."""
    result = await db.execute(
        select(HuntSession)
        .where(HuntSession.user_id == current_user.id)
        .order_by(HuntSession.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.get("/{session_id}")
async def get_hunt(
    session_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get hunt session details including query results."""
    session = (await db.execute(
        select(HuntSession).where(HuntSession.id == session_id, HuntSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Hunt session not found")

    return {
        "id": session.id,
        "hypothesis": session.hypothesis,
        "status": session.status,
        "queries_run": session.queries_run,
        "findings_count": session.findings_count,
        "result_data": session.result_data,
        "sigma_rule": session.sigma_rule,
        "created_at": session.created_at,
    }


# --- Detection Rules ---

@router.post("/detections")
async def create_detection_rule(
    rule: DetectionRuleCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Save a detection rule (AI-generated or manual)."""
    detection = DetectionRule(
        user_id=current_user.id,
        name=rule.name,
        description=rule.description,
        rule_type=rule.rule_type,
        rule_content=rule.rule_content,
        mitre_techniques=rule.mitre_techniques,
        confidence=rule.confidence,
        created_by="human",
    )
    db.add(detection)
    await db.commit()
    await db.refresh(detection)
    return DetectionRuleResponse.model_validate(detection)


@router.get("/detections", response_model=list[DetectionRuleResponse])
async def list_detection_rules(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all detection rules."""
    result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.user_id == current_user.id)
        .order_by(DetectionRule.created_at.desc())
    )
    return result.scalars().all()
