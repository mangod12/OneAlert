"""Truthful query/session outcomes, including recoverable database failures."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

import backend.main  # noqa: F401
from backend.models.security_event import SecurityEvent
from backend.services.agents.hunt import HuntAgent

SQL = "SELECT id FROM security_events WHERE user_id = :user_id"


def make_agent(monkeypatch, queries):
    import backend.services.agents.hunt as module

    provider = Mock(model="test")
    provider.complete_json = AsyncMock(return_value={"queries": queries})
    monkeypatch.setattr(module, "get_ai_provider", lambda task: provider)
    result = Mock()
    result.keys.return_value = ["id"]
    result.fetchall.return_value = [(1,)]
    instance = HuntAgent(
        Mock(execute=AsyncMock(return_value=result), begin_nested=MagicMock(return_value=AsyncMock())), 123
    )
    instance.log_step = AsyncMock()
    return instance


def test_mixed_outcomes_distinguish_rejection_from_execution_failure(monkeypatch):
    instance = make_agent(monkeypatch, [{"sql": SQL}, {"sql": SQL + " OR 1 = 1"}, {"sql": SQL}])
    result = instance.db.execute.return_value
    instance.db.execute.side_effect = [result, RuntimeError("database unavailable")]
    output = asyncio.run(instance.run(hypothesis="review"))
    assert output["status"] == "partial"
    assert output["execution_summary"] == {"completed": 1, "rejected": 1, "failed": 1, "attempted": 2, "skipped": 0}
    assert [item["outcome"] for item in output["query_results"]] == ["completed", "rejected", "failed"]
    assert output["query_results"][2]["error"] == "database unavailable"
    assert datetime.fromisoformat(output["recorded_at"]).utcoffset().total_seconds() == 0
    assert instance.db.begin_nested.call_count == 2


@pytest.mark.parametrize(
    "queries, status, summary",
    [
        ([{"sql": SQL}], "completed", {"completed": 1, "rejected": 0, "failed": 0, "attempted": 1, "skipped": 0}),
        (
            [{"sql": SQL + " LIMIT 0"}],
            "failed",
            {"completed": 0, "rejected": 1, "failed": 0, "attempted": 0, "skipped": 0},
        ),
        ([], "failed", {"completed": 0, "rejected": 0, "failed": 0, "attempted": 0, "skipped": 0}),
        (
            [{"sql": SQL} for _ in range(5)],
            "partial",
            {"completed": 3, "rejected": 0, "failed": 0, "attempted": 3, "skipped": 2},
        ),
    ],
)
def test_overall_status_and_three_query_cap(monkeypatch, queries, status, summary):
    instance = make_agent(monkeypatch, queries)
    output = asyncio.run(instance.run(hypothesis="review"))
    assert output["status"] == status
    assert output["execution_summary"] == summary
    assert len(output["query_results"]) <= 3
    if not queries:
        assert output["error"] == "No hunt queries were generated"
    if not summary["attempted"]:
        instance.db.execute.assert_not_awaited()
        instance.db.begin_nested.assert_not_called()


def test_database_error_rolls_back_only_its_savepoint_and_preserves_later_result(monkeypatch):
    instance = make_agent(monkeypatch, [{"sql": SQL}, {"sql": SQL}])

    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(SecurityEvent.__table__.create)
            async with AsyncSession(engine) as db:
                db.add(SecurityEvent(id=1, user_id=123, timestamp=datetime.now(UTC), event_type="alert"))
                await db.commit()
                original_execute = db.execute
                calls = 0

                async def fail_first(query):
                    nonlocal calls
                    calls += 1
                    if calls == 1:
                        return await original_execute(text("SELECT * FROM deliberately_missing_test_table"))
                    return await original_execute(query)

                monkeypatch.setattr(db, "execute", fail_first)
                instance.db = db
                output = await instance.run(hypothesis="review")
                assert output["status"] == "partial"
                assert output["execution_summary"]["failed"] == 1
                assert output["execution_summary"]["completed"] == 1
                assert output["query_results"][1]["rows"] == [{"id": 1}]
                await db.commit()
                assert (await original_execute(text("SELECT count(*) FROM security_events"))).scalar_one() == 1
        finally:
            await engine.dispose()

    asyncio.run(scenario())
