"""Parser acceptance metadata for a bounded event file, without database work."""

import hashlib
from datetime import UTC, datetime

import backend.services.event_ingestion as ingestion
from backend.services.event_upload import parse_event_upload


def event_preview_fingerprint(content: bytes, source_type: str) -> str:
    """Bind original bytes and parser context, not an authorization or signature."""
    return hashlib.sha256(b"onealert_event_parser_preview_v1\0" + source_type.encode() + b"\0" + content).hexdigest()


def preview_event_file(content: bytes, source_type: str) -> dict:
    if source_type not in {"suricata", "zeek"}:
        raise ValueError("Preview supports the Suricata and Zeek parsers only")
    records = parse_event_upload(content)
    parser = ingestion.PARSERS[source_type]
    accepted = redactions = 0
    reasons = {}
    positions = {}
    for position, raw in enumerate(records, 1):
        _, reason, count = ingestion.inspect_event_record(raw, parser)
        if reason is None:
            accepted += 1
            redactions += count
        else:
            reasons[reason] = reasons.get(reason, 0) + 1
            if len(positions.setdefault(reason, [])) < 10:
                positions[reason].append(position)
    return {
        "format": "onealert_event_parser_preview_v1",
        "source_type": source_type,
        "fingerprint": event_preview_fingerprint(content, source_type),
        "byte_size": len(content),
        "previewed_at": datetime.now(UTC).isoformat(),
        "received": len(records),
        "accepted": accepted,
        "skipped": len(records) - accepted,
        "redactions_in_accepted": redactions,
        "skip_reasons": reasons,
        "skipped_positions": {
            reason: {"record_positions": values, "omitted_positions": reasons[reason] - len(values)}
            for reason, values in positions.items()
        },
        "scope": "Parser acceptance using the same per-record inspection as import, not a database write, "
        "commit-success prediction, import receipt, duplicate-detection guarantee or threat conclusion. "
        "No event/source database reads or writes, source creation, provider call, detection or response action. "
        "Only the first ten one-based parsed-record positions per reason are listed, not NDJSON line numbers. "
        "No raw values, normalized payloads or exception strings are returned. Redactions count accepted "
        "records only. The fingerprint binds file bytes and parser context, not authorization or an "
        "authenticated signature, and can identify sensitive input. A later import is a separate action; "
        "database constraints and failures can still prevent it. Reimporting can create duplicate events.",
    }
