"""Malformed normalized data must not poison an otherwise valid batch."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.security_event import EventSource, SecurityEvent
from backend.services.event_ingestion import ingest_events
from backend.services.normalized_event import validate_normalized_event

STAMP = "2026-01-01T00:00:00Z"


@pytest.mark.parametrize(
    "key,value",
    [
        ("source_port", {}),
        ("source_port", "bad"),
        ("source_port", True),
        ("source_port", -1),
        ("dest_port", 65536),
        ("dest_port", 1.5),
        ("bytes_in", -1),
        ("bytes_out", 2147483648),
        ("event_type", []),
        ("hostname", {}),
        ("user_id", 99),
        ("source_id", 99),
        ("raw_data", {"bad": float("nan")}),
    ],
)
def test_invalid_normalized_fields_are_rejected_before_binding(key, value):
    parsed = {"timestamp": datetime.now(UTC), "event_type": "alert", key: value}
    with pytest.raises((ValueError, TypeError)):
        validate_normalized_event(parsed)


def test_zero_null_and_boundary_values_are_preserved_without_coercion():
    parsed = {
        "timestamp": datetime.now(UTC),
        "event_type": "alert",
        "source_port": 0,
        "dest_port": 65535,
        "bytes_in": 0,
        "bytes_out": 2147483647,
        "hostname": None,
        "raw_data": {"false": False, "zero": 0},
    }
    assert validate_normalized_event(parsed) == parsed


def test_mixed_batch_commits_valid_rows_once_and_counts_bad_fields(tmp_path):
    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'normalized.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                valid = {"timestamp": STAMP, "event_type": "alert", "src_port": 0, "dest_port": 65535}
                rows = [
                    valid,
                    {**valid, "src_port": {"bad": "object"}},
                    {**valid, "src_port": "bad"},
                    {**valid, "src_port": True},
                    {**valid, "src_port": 65536},
                    {**valid, "event_type": "flow", "flow": {"bytes_toclient": -1}},
                ]
                original_commit = db.commit
                db.commit = AsyncMock(wraps=original_commit)
                output = await ingest_events(db, 1, rows, "suricata", "normalized-test")
                assert output["ingested"] == 1 and output["skipped"] == 5
                assert output["skip_reasons"] == {"invalid_fields": 5}
                db.commit.assert_awaited_once()
                assert (await db.execute(select(func.count(SecurityEvent.id)))).scalar_one() == 1
                event = (await db.execute(select(SecurityEvent))).scalar_one()
                assert event.user_id == 1 and event.source_port == 0 and event.dest_port == 65535
                source = (await db.execute(select(EventSource))).scalar_one()
                assert source.event_count == 1 and event.source_id == source.id
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_database_commit_failure_rolls_back_and_never_returns_a_false_ingested_count(monkeypatch):
    import backend.services.event_ingestion as service

    db = Mock(
        add=Mock(),
        execute=AsyncMock(),
        commit=AsyncMock(side_effect=RuntimeError("write failed")),
        rollback=AsyncMock(),
    )
    source = Mock(id=1, event_count=0)
    monkeypatch.setattr(service, "_get_or_create_source", AsyncMock(return_value=source))
    with pytest.raises(RuntimeError, match="write failed"):
        asyncio.run(ingest_events(db, 1, [{"timestamp": STAMP, "event_type": "alert"}], "suricata"))
    db.rollback.assert_awaited_once()
    db.commit.assert_awaited_once()


def test_unknown_source_nested_errors_and_redactions_are_accounted_only_for_stored_rows(tmp_path):
    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'edge.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                output = await ingest_events(db, 9, [
                    {"event_type": "auth", "source_ip": "10.0.0.1", "note": "analyst@example.test"},
                    {"event_type": {}, "note": "other@example.test"},
                    {"event_type": "auth", "bad": float("inf")},
                ], "webhook")
                assert output["received"] == 3 and output["ingested"] == 1 and output["skipped"] == 2
                assert output["redacted"] == 1 and output["skip_reasons"] == {"invalid_fields": 2}
                event = (await db.execute(select(SecurityEvent))).scalar_one()
                assert event.user_id == 9 and event.source_type == "unknown"
                assert event.raw_data["note"] == "[REDACTED_EMAIL]"
                output = await ingest_events(db, 9, [
                    {"timestamp": STAMP, "event_type": "alert", "alert": []},
                    {"timestamp": STAMP, "event_type": "http", "http": None},
                    {"timestamp": STAMP, "event_type": "flow", "flow": "bad"},
                    {"timestamp": STAMP, "event_type": "alert"},
                    None,
                ], "suricata")
                assert output["received"] == 5 and output["ingested"] == 1 and output["skipped"] == 4
                assert output["skip_reasons"] == {"parse_error": 3, "invalid_record": 1}
                assert (await db.execute(select(func.count(SecurityEvent.id)))).scalar_one() == 2
        finally:
            await engine.dispose()
    asyncio.run(scenario())


def test_real_database_failure_reverts_source_receipt_and_leaves_session_usable(tmp_path):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'rollback.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                await ingest_events(db, 1, [{"timestamp": STAMP, "event_type": "alert"}], "suricata")
                source = (await db.execute(select(EventSource))).scalar_one()
                original_id, original_time = source.id, source.last_event_at
                await db.execute(text(
                    "CREATE TRIGGER reject_events BEFORE INSERT ON security_events "
                    "BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END"
                ))
                await db.commit()
                with pytest.raises(IntegrityError):
                    await ingest_events(db, 1, [{"timestamp": STAMP, "event_type": "alert"}], "suricata")
                source = (await db.execute(select(EventSource).where(EventSource.id == original_id))).scalar_one()
                assert source.event_count == 1 and source.last_event_at == original_time
                assert (await db.execute(select(func.count(SecurityEvent.id)))).scalar_one() == 1
                await db.execute(text("DROP TRIGGER reject_events"))
                await db.commit()
                output = await ingest_events(db, 1, [{"timestamp": STAMP, "event_type": "alert"}], "suricata")
                assert output["ingested"] == 1
        finally:
            await engine.dispose()
    asyncio.run(scenario())
