"""Prepare hunt queries without reading events; execute only explicitly selected saved drafts."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.case import AgentRun
from backend.models.detection_rule import HuntSession
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.hunt_query_drafts import (
    HuntQueryDraftAgent,
    RefinedHuntQueryDraftAgent,
    ReviewedHuntQueriesAgent,
    normalized_query,
    read_draft,
)

router = APIRouter(prefix="/query-drafts")


class PrepareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hypothesis: str = Field(..., min_length=1, max_length=4000)


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fingerprint: str = Field(..., min_length=64, max_length=64, pattern="^[0-9a-f]{64}$")
    query_numbers: list[Annotated[StrictInt, Field(ge=1, le=3)]] = Field(..., min_length=1, max_length=3)

    @field_validator("query_numbers")
    @classmethod
    def unique_queries(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Select each original query at most once")
        return sorted(value)


class QueryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: Annotated[StrictInt, Field(ge=1, le=3)]
    sql: str = Field(..., min_length=1, max_length=12000)
    params: dict[str, str] = Field(default_factory=dict, max_length=3)

    @field_validator("params")
    @classmethod
    def supported_parameters(cls, value):
        if set(value) - {"since", "before", "keyword"} or any(
            not item or len(item) > 2048 for item in value.values()
        ):
            raise ValueError("Use bounded since, before or keyword parameters only")
        return value


class RefineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fingerprint: str = Field(..., min_length=64, max_length=64, pattern="^[0-9a-f]{64}$")
    edits: list[QueryEdit] = Field(..., min_length=1, max_length=3)

    @field_validator("edits")
    @classmethod
    def unique_positions(cls, value):
        if len({item.position for item in value}) != len(value):
            raise ValueError("Edit each original query at most once")
        return sorted(value, key=lambda item: item.position)


async def save_run(db, owner, hypothesis, agent):
    session = HuntSession(user_id=owner, hypothesis=hypothesis, queries_run=0, findings_count=0)
    db.add(session)
    await db.flush()
    try:
        result = await agent.execute(hypothesis=hypothesis)
    except Exception:
        result = {
            "status": "failed",
            "error": "Hunt draft workflow interrupted. Inspect its recorded run. "
            "No complete query result is retained; this is not a zero-finding result.",
            "summary": "Hunt draft workflow interrupted before its complete result was saved.",
        }
    if isinstance(agent, ReviewedHuntQueriesAgent):
        result = {
            **result,
            "reviewed_draft": {
                "session_id": agent.source_id,
                "fingerprint": agent.fingerprint,
                "query_numbers": agent.selected,
                "scope": "Selected saved queries only; current owned rows, not the earlier draft snapshot.",
            },
        }
    if agent._run is not None:
        result = {**result, "agent_run_id": agent._run.id}
    session.status, session.result_data = result.get("status", "failed"), result
    session.completed_at = None if session.status == "prepared" else datetime.now(UTC)
    session.queries_run = result.get("execution_summary", {}).get("attempted", 0)
    session.findings_count = sum(row.get("row_count", 0) for row in result.get("query_results", []))
    await db.commit()
    return session


async def owned_draft(db, owner, identity):
    session = (
        await db.execute(select(HuntSession).where(HuntSession.id == identity, HuntSession.user_id == owner))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(404, "Hunt query draft not found")
    try:
        draft, fingerprint, prepared, expires = read_draft(session)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    return session, draft, fingerprint, prepared, expires


async def draft_view(db, owner, identity):
    session, draft, fingerprint, prepared, expires = await owned_draft(db, owner, identity)
    run_id = session.result_data.get("agent_run_id")
    if (
        type(run_id) is not int
        or (
            await db.execute(
                select(AgentRun.id).where(
                    AgentRun.id == run_id, AgentRun.user_id == owner, AgentRun.agent_type == "hunt"
                )
            )
        ).scalar_one_or_none()
        is None
    ):
        run_id = None
    now = datetime.now(UTC)
    return {
        "session_id": identity,
        "hypothesis": session.hypothesis,
        "fingerprint": fingerprint,
        "draft": draft,
        "agent_run_id": run_id,
        "read_at": now.isoformat(),
        "can_execute": prepared <= now + timedelta(seconds=5)
        and now <= expires
        and any(query["accepted"] for query in draft["queries"]),
        "scope": "Saved compiler review only, not executed query results. Execution is a separate explicit POST.",
    }


@router.post("")
async def prepare_queries(
    req: PrepareRequest, current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db)
):
    if not req.hypothesis.strip():
        raise HTTPException(422, "A nonempty hypothesis is required")
    session = await save_run(db, current_user.id, req.hypothesis, HuntQueryDraftAgent(db, current_user.id))
    if session.status != "prepared":
        return {"success": False, "data": {**session.result_data, "session_id": session.id}}
    return {"success": True, "data": await draft_view(db, current_user.id, session.id)}


@router.get("/{draft_id}")
async def get_queries(
    draft_id: Annotated[int, Path(ge=1, le=2147483647)],
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    return await draft_view(db, current_user.id, draft_id)


@router.post("/{draft_id}/refinements")
async def refine_queries(
    draft_id: Annotated[int, Path(ge=1, le=2147483647)],
    req: RefineRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    source, draft, fingerprint, _, _ = await owned_draft(db, current_user.id, draft_id)
    if fingerprint != req.fingerprint:
        raise HTTPException(409, "Saved query draft changed. Reload it before saving edits.")
    if any(edit.position > len(draft["queries"]) for edit in req.edits):
        raise HTTPException(422, "An edited original query is unavailable")
    changed = [
        edit for edit in req.edits
        if edit.sql != draft["queries"][edit.position - 1].get("sql")
        or edit.params != draft["queries"][edit.position - 1].get("params")
    ]
    if not changed:
        raise HTTPException(422, "Change query SQL or parameters before saving a refined draft")
    agent = RefinedHuntQueryDraftAgent(
        db, current_user.id, source.id, fingerprint, draft,
        [edit.model_dump() for edit in changed],
    )
    session = await save_run(db, current_user.id, source.hypothesis, agent)
    if session.status != "prepared":
        return {"success": False, "data": {**session.result_data, "session_id": session.id}}
    return {"success": True, "data": await draft_view(db, current_user.id, session.id)}


@router.post("/{draft_id}/execute")
async def execute_queries(
    draft_id: Annotated[int, Path(ge=1, le=2147483647)],
    req: ExecuteRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    source, draft, fingerprint, prepared, expires = await owned_draft(db, current_user.id, draft_id)
    now = datetime.now(UTC)
    if fingerprint != req.fingerprint or prepared > now + timedelta(seconds=5) or now > expires:
        raise HTTPException(
            409,
            "Saved query draft changed, expired or has unsupported timing. Prepare or reload it before choosing again.",
        )
    agent = ReviewedHuntQueriesAgent(db, current_user.id, source.id, fingerprint, req.query_numbers, [])
    queries = []
    for number in req.query_numbers:
        if number > len(draft["queries"]):
            raise HTTPException(422, "A selected original query is unavailable")
        item = draft["queries"][number - 1]
        rechecked = normalized_query(agent, item, number)
        if (
            not item["accepted"]
            or not rechecked["accepted"]
            or item.get("execution") != rechecked["execution"]
            or item.get("time_window") != rechecked["time_window"]
        ):
            raise HTTPException(
                409, "A selected query is rejected or its supported execution contract changed. Prepare a new draft."
            )
        queries.append(
            {
                "sql": item["sql"],
                "description": item["description"],
                "params": item["params"],
                "reviewed_query_number": number,
            }
        )
    agent.reviewed_queries = queries
    session = await save_run(db, current_user.id, source.hypothesis, agent)
    return {"success": True, "data": {**session.result_data, "session_id": session.id}}
