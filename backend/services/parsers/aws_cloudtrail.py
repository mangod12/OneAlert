"""Normalize explicitly selected AWS CloudTrail records, not verified AWS evidence.

Contracts: CloudTrail record contents and log-file examples in AWS's user guide.
API names are recorded labels, never confirmed execution or threat conclusions.
"""

import ipaddress
import re

from backend.services.parsers.event_time import observed_timestamp


def _text(value, *, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError("CloudTrail used text field must be nonempty text")
    return value


def parse_aws_cloudtrail(raw: dict) -> dict | None:
    version = raw.get("eventVersion")
    if not isinstance(version, str) or len(version) > 16 or re.fullmatch(r"1\.[0-9]+", version) is None:
        return None
    timestamp = observed_timestamp(raw.get("eventTime"))
    service, name = _text(raw.get("eventSource")), _text(raw.get("eventName"))
    identity = raw.get("userIdentity")
    if not isinstance(identity, dict):
        raise ValueError("CloudTrail userIdentity must be an object")
    address = _text(raw.get("sourceIPAddress"), optional=True)
    if address is not None:
        try:
            ipaddress.ip_address(address)
        except ValueError:
            address = None  # AWS also records service DNS names and AWS Internal labels.
        else:
            if "%" in address:
                address = None  # A zone-scoped interface label is not a CloudTrail IP endpoint.
    return {
        "timestamp": timestamp,
        "event_type": "aws_cloudtrail",
        "source_type": "aws_cloudtrail",
        "severity": "info",
        "signature": f"CloudTrail: {service} / {name}",
        "category": "aws_cloudtrail",
        "username": _text(identity.get("userName"), optional=True),
        "source_ip": address,
        "raw_data": raw,
    }
