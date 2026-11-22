"""Normalize supplied Okta System Log records, not verified provider evidence.

published is the provider's publication time, not persistence, ingestion or a
verified occurrence clock. Non-user actors never become normalized usernames.
"""

import ipaddress
import re

from backend.services.parsers.event_time import EventTimestampError, observed_timestamp

PUBLISHED = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)")


def _text(value, *, optional=False, limit=512):
    if optional and (value is None or (isinstance(value, str) and not value.strip())):
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Okta used text must be bounded nonempty text")
    return value


def _object(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Okta used nested context must be an object")
    return value


def parse_okta_system(raw: dict) -> dict | None:
    if not {"uuid", "eventType", "actor"}.issubset(raw):
        return None
    _text(raw["uuid"])
    event_type = _text(raw["eventType"])
    published = raw.get("published")
    if not isinstance(published, str) or not PUBLISHED.fullmatch(published):
        raise EventTimestampError("Okta published must be timezone-aware date-time text, at most microsecond precision")
    try:
        timestamp = observed_timestamp(published)
    except (OverflowError, ValueError) as exc:
        raise EventTimestampError("Okta published cannot be represented in UTC") from exc
    actor = raw["actor"]
    if not isinstance(actor, dict):
        raise ValueError("Okta actor must be an object")
    actor_type = _text(actor.get("type"), optional=True)
    username = _text(actor.get("alternateId"), optional=True) if actor_type == "User" else None
    client = _object(raw.get("client"))
    address = _text(client.get("ipAddress"), optional=True, limit=128)
    if address is not None:
        ipaddress.ip_address(address)
        if "%" in address:
            raise ValueError("Okta client address cannot contain an interface zone")
    result = _text(_object(raw.get("outcome")).get("result"), optional=True)
    return {
        "timestamp": timestamp,
        "event_type": "okta_system",
        "source_type": "okta_system",
        "severity": "info",
        "signature": f"Okta System Log: {event_type}",
        "category": "identity_audit",
        "username": username,
        "source_ip": address,
        "action": f"recorded_outcome:{result}" if result is not None else None,
        "raw_data": raw,
    }
