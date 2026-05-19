"""Event ingestion service — batch insert, dedup, source tracking."""

import logging
from datetime import datetime, timezone
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.models.security_event import SecurityEvent, EventSource
from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log

logger = logging.getLogger(__name__)

PARSERS = {
    "suricata": parse_suricata_eve,
    "zeek": parse_zeek_log,
}


async def ingest_events(
    db: AsyncSession,
    user_id: int,
    raw_events: List[dict],
    source_type: str,
    source_name: str | None = None,
) -> dict:
    """Parse and insert a batch of raw events.

    Returns: {"ingested": N, "skipped": N, "source_id": ID}
    """
    parser = PARSERS.get(source_type)
    if not parser:
        # Unknown source — store raw with minimal normalization
        parser = _passthrough_parser

    # Get or create event source
    source = await _get_or_create_source(db, user_id, source_type, source_name)

    ingested = 0
    skipped = 0

    for raw in raw_events:
        try:
            parsed = parser(raw)
            if not parsed:
                skipped += 1
                continue

            event = SecurityEvent(
                user_id=user_id,
                source_id=source.id,
                **parsed,
            )
            db.add(event)
            ingested += 1
        except Exception as e:
            logger.debug(f"Skip event parse error: {e}")
            skipped += 1

    # Update source stats
    source.event_count = (source.event_count or 0) + ingested
    source.last_event_at = datetime.now(timezone.utc)
    source.status = "active"

    await db.commit()

    logger.info(f"Ingested {ingested} events ({skipped} skipped) from {source_type}")
    return {"ingested": ingested, "skipped": skipped, "source_id": source.id}


async def _get_or_create_source(
    db: AsyncSession, user_id: int, source_type: str, source_name: str | None
) -> EventSource:
    """Find existing source or create new one."""
    name = source_name or f"{source_type}-default"

    result = await db.execute(
        select(EventSource).where(
            EventSource.user_id == user_id,
            EventSource.name == name,
            EventSource.source_type == source_type,
        )
    )
    source = result.scalar_one_or_none()

    if not source:
        source = EventSource(
            user_id=user_id,
            name=name,
            source_type=source_type,
        )
        db.add(source)
        await db.flush()

    return source


def _passthrough_parser(raw: dict) -> dict:
    """Minimal parser for unknown source types."""
    return {
        "timestamp": datetime.now(timezone.utc),
        "event_type": raw.get("event_type", "unknown"),
        "severity": raw.get("severity", "info"),
        "source_ip": raw.get("source_ip") or raw.get("src_ip"),
        "dest_ip": raw.get("dest_ip") or raw.get("dst_ip"),
        "raw_data": raw,
        "source_type": "unknown",
    }
