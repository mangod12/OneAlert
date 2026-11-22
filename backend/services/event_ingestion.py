"""Event ingestion service — batch insert, dedup, source tracking."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.security_event import EventSource, SecurityEvent
from backend.services.normalized_event import validate_normalized_event
from backend.services.parsers.event_time import EventTimestampError
from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log
from backend.services.pii_redactor import redact_dict

logger = logging.getLogger(__name__)

PARSERS = {
    "suricata": parse_suricata_eve,
    "zeek": parse_zeek_log,
}


def inspect_event_record(raw, parser):
    """Share parser acceptance with previews, without ORM access or raw-value errors."""
    try:
        if not isinstance(raw, dict):
            return None, "invalid_record", 0
        parsed = parser(raw)
        if not parsed:
            return None, "unsupported_record", 0
        redactions = 0
        if "raw_data" in parsed and isinstance(parsed["raw_data"], dict):
            parsed["raw_data"], redactions = redact_dict(parsed["raw_data"])
        try:
            parsed = validate_normalized_event(parsed)
        except (ValueError, TypeError, OverflowError, RecursionError):
            return None, "invalid_fields", 0
        return parsed, None, redactions
    except EventTimestampError:
        return None, "invalid_timestamp", 0
    except Exception as exc:
        logger.debug(f"Skip event parse error: {type(exc).__name__}")
        return None, "parse_error", 0


async def ingest_events(
    db: AsyncSession,
    user_id: int,
    raw_events: list[dict],
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
    redacted_count = 0
    skip_reasons = {}

    for raw in raw_events:
        try:
            parsed, reason, record_redactions = inspect_event_record(raw, parser)
            if reason is not None:
                skipped += 1
                skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
                continue

            event = SecurityEvent(
                user_id=user_id,
                source_id=source.id,
                **parsed,
            )
            db.add(event)
            ingested += 1
            redacted_count += record_redactions
        except EventTimestampError:
            skipped += 1
            skip_reasons["invalid_timestamp"] = skip_reasons.get("invalid_timestamp", 0) + 1
        except Exception as e:
            logger.debug(f"Skip event parse error: {type(e).__name__}")
            skipped += 1
            skip_reasons["parse_error"] = skip_reasons.get("parse_error", 0) + 1

    # Update source stats
    source.event_count = (source.event_count or 0) + ingested
    if ingested:
        source.last_event_at = datetime.now(UTC)
        source.status = "active"

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    logger.info(f"Ingested {ingested} events ({skipped} skipped, {redacted_count} redactions) from {source_type}")
    return {
        "received": len(raw_events),
        "ingested": ingested,
        "skipped": skipped,
        "redacted": redacted_count,
        "source_id": source.id,
        "skip_reasons": skip_reasons,
    }


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
        "timestamp": datetime.now(UTC),
        "event_type": raw.get("event_type", "unknown"),
        "severity": raw.get("severity", "info"),
        "source_ip": raw.get("source_ip") or raw.get("src_ip"),
        "dest_ip": raw.get("dest_ip") or raw.get("dst_ip"),
        "raw_data": raw,
        "source_type": "unknown",
    }
