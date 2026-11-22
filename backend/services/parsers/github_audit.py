"""Normalize supplied GitHub audit JSON, not authenticated GitHub evidence.

GitHub documents created_at as integer milliseconds since the Unix epoch.
Actor and affected-user fields have different meanings and are not aliases.
"""

from datetime import UTC, datetime, timedelta

from backend.services.parsers.event_time import EventTimestampError

CONTEXT_FIELDS = ("_document_id", "org", "business", "repo")


def _text(value, *, optional=False):
    if optional and (value is None or (isinstance(value, str) and not value.strip())):
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 512:
        raise ValueError("GitHub audit used text must be bounded nonempty text")
    return value


def _created_at(value):
    if type(value) is not int or value < 0:
        raise EventTimestampError("GitHub audit created_at must be nonnegative integer epoch milliseconds")
    seconds, milliseconds = divmod(value, 1000)
    try:
        return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(seconds=seconds, milliseconds=milliseconds)
    except (ValueError, OverflowError) as exc:
        raise EventTimestampError("GitHub audit created_at is outside the supported range") from exc


def parse_github_audit(raw: dict) -> dict | None:
    # A selected parser is not provider authentication. Still require a native
    # audit context, rather than guessing from generic action/time objects.
    if "action" not in raw or not any(
        isinstance(raw.get(key), str) and raw[key].strip() and len(raw[key]) <= 1024 for key in CONTEXT_FIELDS
    ):
        return None
    action = _text(raw["action"])
    timestamp = _created_at(raw.get("created_at"))
    return {
        "timestamp": timestamp,
        "event_type": "github_audit",
        "source_type": "github_audit",
        "severity": "info",
        "signature": f"GitHub audit: {action}",
        "category": "github_audit",
        "username": _text(raw.get("actor"), optional=True),
        "raw_data": raw,
    }
