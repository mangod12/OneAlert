"""Known sensor parsers must preserve recorded event time, not upload time."""

import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.security_event import EventSource, SecurityEvent
from backend.services.event_ingestion import ingest_events
from backend.services.parsers.event_time import EventTimestampError, observed_timestamp
from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log


@pytest.mark.parametrize(
    "value",
    [
        None,
        True,
        False,
        "",
        "invalid",
        "2026-01-01",
        "2026-01-01T12:00:00",
        "NaN",
        "Infinity",
        float("inf"),
        float("nan"),
        {},
        [],
        1e30,
    ],
)
def test_invalid_or_ambiguous_zeek_time_is_never_replaced_with_current_time(value):
    with pytest.raises((EventTimestampError, OverflowError)):
        parse_zeek_log({"_path": "conn", "ts": value})


@pytest.mark.parametrize("value", [None, True, "", "invalid", "2026-01-01", "2026-01-01T12:00:00", 0, {}, []])
def test_invalid_suricata_time_is_never_replaced_with_current_time(value):
    with pytest.raises(EventTimestampError):
        parse_suricata_eve({"timestamp": value, "event_type": "alert"})


@pytest.mark.parametrize(
    "parser,raw",
    [
        (parse_suricata_eve, {"timestamp": "2026-01-01T10:30:00+05:30", "event_type": "alert"}),
        (parse_zeek_log, {"ts": "2026-01-01T10:30:00+05:30", "_path": "conn"}),
    ],
)
def test_offset_recorded_time_is_normalized_before_storage(parser, raw):
    assert parser(raw)["timestamp"] == datetime(2026, 1, 1, 5, tzinfo=UTC)
    assert parser(raw)["timestamp"].tzinfo == UTC


def test_zeek_epoch_zero_fractional_and_numeric_text_are_preserved():
    assert observed_timestamp(0, epoch_allowed=True) == datetime(1970, 1, 1, tzinfo=UTC)
    assert observed_timestamp("0.25", epoch_allowed=True).microsecond == 250000
    assert observed_timestamp(1.5, epoch_allowed=True).second == 1


@pytest.mark.parametrize("kind", ["suricata", "zeek"])
def test_ingestion_records_skip_reasons_and_only_stores_valid_observed_times(tmp_path, kind):
    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'event-time.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                valid = (
                    {"timestamp": "2026-01-01T10:30:00+05:30", "event_type": "alert"}
                    if kind == "suricata"
                    else {"ts": "2026-01-01T10:30:00+05:30", "_path": "conn"}
                )
                bad = (
                    {"timestamp": "invalid", "event_type": "alert"}
                    if kind == "suricata"
                    else {"ts": "invalid", "_path": "conn"}
                )
                output = await ingest_events(db, 1, [valid, bad, {}, []], kind, "recorded-source")
                assert output["ingested"] == 1 and output["skipped"] == 3
                assert output["skip_reasons"] == {"invalid_timestamp": 2, "invalid_record": 1}
                events = (await db.execute(select(SecurityEvent))).scalars().all()
                assert len(events) == 1 and events[0].user_id == 1
                assert events[0].timestamp == datetime(2026, 1, 1, 5, tzinfo=UTC).replace(tzinfo=None)
                source = (await db.execute(select(EventSource))).scalar_one()
                last_received = source.last_event_at
                assert source.event_count == 1
                # A rejected-only batch must not claim a fresh accepted event.
                again = await ingest_events(db, 1, [bad], kind, "recorded-source")
                assert again["ingested"] == 0 and again["skip_reasons"]["invalid_timestamp"] == 1
                await db.refresh(source)
                assert source.event_count == 1
                assert source.last_event_at.replace(tzinfo=None) == last_received.replace(tzinfo=None)
        finally:
            await engine.dispose()

    asyncio.run(scenario())
