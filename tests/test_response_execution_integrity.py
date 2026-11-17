"""Regression tests for response execution approval and durable result recording."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import JSON, Column, Integer, String
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.services.action_executor import execute_response_plan


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["draft", "pending_approval", "rejected", "executing", "completed", "partial"])
async def test_executor_rejects_unapproved_plan_without_side_effects(status):
    plan = MagicMock(status=status, actions=[{"action_type": "notify", "target": "soc"}])
    db = AsyncMock()
    with pytest.raises(ValueError, match="must be approved"):
        await execute_response_plan(db=db, plan=plan)
    assert plan.status == status
    db.flush.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_actions_cannot_report_successful_completion():
    plan = MagicMock(status="approved", actions=[{"action_type": "unknown", "target": "host"}])
    result = await execute_response_plan(db=AsyncMock(), plan=plan)
    assert result["status"] == "partial"
    assert result["succeeded"] == 0
    assert result["failed"] == 1
    assert result["results"][0]["status"] == "skipped"
    assert result["results"][0]["executed_at"]


class ResultTestBase(DeclarativeBase):
    pass


class StoredPlan(ResultTestBase):
    """Minimal SQLAlchemy model with the same JSON persistence semantics as ResponsePlan."""

    __tablename__ = "test_execution_plans"
    id = Column(Integer, primary_key=True)
    status = Column(String)
    actions = Column(JSON)


@pytest.mark.asyncio
async def test_execution_results_survive_database_reload_without_mutating_input():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(ResultTestBase.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            original_actions = [{"action_type": "notify", "target": "soc", "priority": 1}]
            plan = StoredPlan(status="approved", actions=original_actions)
            db.add(plan)
            await db.commit()
            plan_id = plan.id
            await execute_response_plan(db=db, plan=plan)
            assert "execution_result" not in original_actions[0]
        async with sessions() as db:
            stored = await db.get(StoredPlan, plan_id)
            assert stored.status == "completed"
            assert stored.actions[0]["execution_result"]["status"] == "completed"
            assert stored.actions[0]["execution_result"]["executed_at"]
    finally:
        await engine.dispose()
