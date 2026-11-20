"""Normalize recorded sensor time without inventing observation timestamps."""
import math
from datetime import UTC, datetime


class EventTimestampError(ValueError):
    """Record has no usable, unambiguous observed time."""


def observed_timestamp(value, *, epoch_allowed=False):
    if isinstance(value, bool) or value is None:
        raise EventTimestampError('Recorded timestamp is missing or invalid')
    if epoch_allowed and isinstance(value, (int, float, str)):
        try:
            epoch = float(value)
        except ValueError:
            pass
        else:
            if not math.isfinite(epoch):
                raise EventTimestampError('Recorded epoch must be finite')
            try:
                return datetime.fromtimestamp(epoch, tz=UTC)
            except (ValueError, OverflowError, OSError) as exc:
                raise EventTimestampError('Recorded epoch is outside the supported range') from exc
    if not isinstance(value, str) or not value:
        raise EventTimestampError('Recorded timestamp must be timezone-aware ISO8601 text')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise EventTimestampError('Recorded timestamp is invalid') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise EventTimestampError('Recorded timestamp must include a timezone')
    return parsed.astimezone(UTC)
