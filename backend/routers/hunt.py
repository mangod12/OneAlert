"""Hunt router — threat hunting sessions and detection rules."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.detection_rule import DetectionRule, DetectionRuleResponse, HuntSession, HuntSessionResponse
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.hunt_query_drafts import router as query_drafts_router
from backend.routers.hunt_retained_rows import router as retained_rows_router
from backend.services.hunt_retained_review import retained_fingerprint

router = APIRouter()
router.include_router(query_drafts_router)
router.include_router(retained_rows_router)


class HuntRequest(BaseModel):
    hypothesis: str = Field(..., min_length=1, max_length=4000)


class DetectionRuleCreate(BaseModel):
    name: str
    rule_type: str  # sigma, suricata, yara, sql
    rule_content: str
    description: str | None = None
    mitre_techniques: list | None = None
    confidence: str = "medium"
    enabled: bool = True


class DetectionRuleUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    confidence: str | None = Field(None, pattern="^(low|medium|high)$")
    enabled: bool | None = None


@router.post("/")
async def start_hunt(
    req: HuntRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Start a threat hunting session with a natural-language hypothesis."""
    from backend.services.agents.hunt import HuntAgent

    if not req.hypothesis.strip():
        raise HTTPException(status_code=422, detail='A nonempty hunting hypothesis is required')

    # Create session record
    session = HuntSession(
        user_id=current_user.id,
        hypothesis=req.hypothesis,
    )
    db.add(session)
    await db.flush()

    # Run hunt agent
    agent = HuntAgent(db=db, user_id=current_user.id)
    try:
        result = await agent.execute(hypothesis=req.hypothesis)
    except Exception:
        # BaseAgent already saved the failed run. Do not strand its separately
        # committed hunt session as running or invent successful/empty queries.
        result = {'status': 'failed', 'recorded_at': datetime.now(UTC).isoformat(),
                  'summary': 'Hunt interrupted before a complete session result was saved.',
                  'error': 'Hunt execution did not complete. Inspect the recorded run before retrying. '
                           'No complete query results are retained in this session; this is not a zero-finding result.'}
    if agent._run is not None:
        result = {**result, 'agent_run_id': agent._run.id}

    # Update session
    session.status = result.get("status", "completed")
    session.completed_at = datetime.now(UTC)
    session.queries_run = result.get("execution_summary", {}).get(
        "attempted", len(result.get("query_results", [])),
    )
    session.findings_count = sum(r.get("row_count", 0) for r in result.get("query_results", []))
    session.result_data = result
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


@router.get("/history")
async def hunt_history(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    state: str | None = Query(None, pattern="^(running|prepared|completed|partial|failed)$"),
    with_findings: bool = Query(False),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Search all owned hunt metadata without loading stored query-result rows."""
    predicates = [HuntSession.user_id == current_user.id]
    if search and search.strip():
        term = search.strip()
        predicates.append(or_(
            HuntSession.hypothesis.icontains(term, autoescape=True),
            cast(HuntSession.id, String).icontains(term, autoescape=True),
        ))
    if state:
        predicates.append(HuntSession.status == state)
    if with_findings:
        predicates.append(HuntSession.findings_count > 0)
    total = (await db.execute(select(func.count()).select_from(HuntSession).where(*predicates))).scalar_one()
    rows = (await db.execute(select(
        HuntSession.id, HuntSession.hypothesis, HuntSession.status,
        HuntSession.queries_run, HuntSession.findings_count,
        HuntSession.created_at, HuntSession.completed_at,
    ).where(*predicates).order_by(
        HuntSession.created_at.desc(), HuntSession.id.desc(),
    ).offset((page - 1) * size).limit(size))).mappings().all()
    return {"sessions": [dict(row) for row in rows], "total": total, "page": page, "size": size}


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

    # New receipts name their exact run. Never infer links for historical data,
    # and never turn a malformed/foreign stored ID into another account's link.
    from backend.models.case import AgentRun
    data = session.result_data
    run_id = data.get('agent_run_id') if isinstance(data, dict) else None
    if type(run_id) is not int or run_id < 1 or (await db.execute(select(AgentRun.id).where(
        AgentRun.id == run_id, AgentRun.user_id == current_user.id, AgentRun.agent_type == 'hunt',
    ))).scalar_one_or_none() is None:
        run_id = None
    if isinstance(data, dict) and 'agent_run_id' in data:
        data = {**data, 'agent_run_id': run_id}

    return {
        "id": session.id,
        "hypothesis": session.hypothesis,
        "status": session.status,
        "queries_run": session.queries_run,
        "findings_count": session.findings_count,
        "result_data": data,
        "retained_evidence_fingerprint": retained_fingerprint(session.id, session.hypothesis, session.result_data),
        "sigma_rule": session.sigma_rule,
        "created_at": session.created_at,
    }


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hunt(
    session_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a hunt session and its stored results."""
    session = (await db.execute(
        select(HuntSession).where(HuntSession.id == session_id, HuntSession.user_id == current_user.id)
    )).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Hunt session not found")
    await db.delete(session)
    await db.commit()


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
        enabled=rule.enabled,
        created_by="human",
    )
    db.add(detection)
    await db.commit()
    await db.refresh(detection)
    return DetectionRuleResponse.model_validate(detection)


@router.get("/detections/{rule_id}", response_model=DetectionRuleResponse)
async def get_detection_rule(
    rule_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read one owned saved rule without enabling, testing or executing it."""
    rule = (await db.execute(select(DetectionRule).where(
        DetectionRule.id == rule_id, DetectionRule.user_id == current_user.id,
    ))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Detection rule not found")
    return DetectionRuleResponse.model_validate(rule)


@router.patch("/detections/{rule_id}", response_model=DetectionRuleResponse)
async def update_detection_rule(
    rule_id: int,
    update: DetectionRuleUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update a detection rule's name, description, confidence, or enabled state."""
    rule = await db.get(DetectionRule, rule_id)
    if not rule or rule.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Detection rule not found")
    if update.name is not None:
        name = update.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        rule.name = name
    if update.description is not None:
        rule.description = update.description
    if update.confidence is not None:
        rule.confidence = update.confidence
    if update.enabled is not None:
        rule.enabled = update.enabled
    await db.commit()
    await db.refresh(rule)
    return DetectionRuleResponse.model_validate(rule)


@router.delete("/detections/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection_rule(
    rule_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a detection rule owned by the current user."""
    rule = await db.get(DetectionRule, rule_id)
    if not rule or rule.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Detection rule not found")
    await db.delete(rule)
    await db.commit()
