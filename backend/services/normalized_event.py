"""Validate normalized fields before batching ORM writes."""
import json
from typing import Annotated

from pydantic import AwareDatetime, ConfigDict, Field, StrictInt

from backend.models.security_event import SecurityEventCreate

Port = Annotated[StrictInt, Field(ge=0, le=65535)]
# These model columns are SQL INTEGER, not BIGINT. Reject values which would
# fail only on commit on stricter backends instead of lying about stored rows.
Counter = Annotated[StrictInt, Field(ge=0, le=2147483647)]


class NormalizedEvent(SecurityEventCreate):
    timestamp: AwareDatetime
    source_port: Port | None = None
    dest_port: Port | None = None
    bytes_in: Counter | None = None
    bytes_out: Counter | None = None

    model_config = ConfigDict(strict=True, extra="forbid")


def validate_normalized_event(parsed: dict) -> dict:
    """Reject incompatible scalars and JSON before database binding happens."""
    record = NormalizedEvent.model_validate(parsed)
    # Raw JSON can otherwise fail at the end of the entire batch. Do not
    # stringify arbitrary objects or accept nonstandard NaN/Infinity values.
    json.dumps(record.raw_data, allow_nan=False)
    return record.model_dump(exclude_unset=True)
