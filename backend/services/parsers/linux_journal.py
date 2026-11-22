"""Normalize explicit systemd journal JSON without interpreting message text.

Uses systemd journal-fields and journalctl JSON contracts. Journal reception
and source time have different meanings; neither authenticates an uploaded file.
"""

import re
from datetime import UTC, datetime, timedelta

from backend.services.parsers.event_time import EventTimestampError


def _journal_time(value):
    # Journal JSON encodes microseconds as decimal text. Never round via float.
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{1,18}", value) is None:
        raise EventTimestampError("Journal timestamp must be decimal microsecond text")
    try:
        return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(microseconds=int(value))
    except (ValueError, OverflowError) as exc:
        raise EventTimestampError("Journal timestamp is outside the supported range") from exc


def _optional_text(raw, key):
    if key not in raw:
        return None
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Journal metadata must be single nonempty text values")
    return value


def parse_linux_journal(raw: dict) -> dict | None:
    """Keep journal evidence informational, without guessing authentication facts."""
    if "MESSAGE" not in raw:
        return None
    message = raw["MESSAGE"]
    if not isinstance(message, str) or not message.strip():
        raise ValueError("Journal message must be a single nonempty text value")
    timestamp = _journal_time(
        raw["_SOURCE_REALTIME_TIMESTAMP"] if "_SOURCE_REALTIME_TIMESTAMP" in raw else raw.get("__REALTIME_TIMESTAMP")
    )
    hostname = _optional_text(raw, "_HOSTNAME")
    unit = _optional_text(raw, "_SYSTEMD_UNIT")
    return {
        "timestamp": timestamp,
        "event_type": "linux_journal",
        "source_type": "linux_journal",
        "severity": "info",
        "signature": f"Linux journal: {unit}" if unit is not None else "Linux journal entry",
        "category": "linux_journal",
        "hostname": hostname,
        "raw_data": raw,
    }
