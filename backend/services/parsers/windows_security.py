"""Normalize explicit Winlogbeat Security-channel JSON, not EVTX or XML.

Source fields: Elastic's Winlogbeat exported-fields-winlog reference. Prefer
winlog.time_created to producer-reported @timestamp; never use collector time.
These are informational records, not detection or action conclusions.
"""

import ipaddress
import re

from backend.services.parsers.event_time import observed_timestamp


def _unsigned(value, maximum, digits):
    if type(value) is int:
        number = value
    elif isinstance(value, str) and re.fullmatch(rf"[0-9]{{1,{digits}}}", value):
        number = int(value)
    else:
        raise ValueError("Windows integer field must be unsigned decimal")
    if not 0 <= number <= maximum:
        raise ValueError("Windows integer field is outside the supported range")
    return number


def _optional_text(value):
    if value is None or value == "-" or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Windows optional text field is invalid")
    return value


def parse_windows_security(raw: dict) -> dict | None:
    """Accept only an explicit Security channel with a bounded decimal event ID.

    The original JSON remains subject to the shared redaction pipeline. Target
    account and remote endpoint fields are not replaced by subject/agent fields.
    """
    winlog = raw.get("winlog")
    if not isinstance(winlog, dict) or winlog.get("channel") not in {"Security", "security"}:
        return None
    event_id = _unsigned(winlog.get("event_id"), (1 << 32) - 1, 10)
    timestamp = observed_timestamp(winlog["time_created"] if "time_created" in winlog else raw.get("@timestamp"))
    data = winlog.get("event_data", {})
    if not isinstance(data, dict):
        raise ValueError("Windows event_data must be an object when present")
    address = _optional_text(data.get("IpAddress"))
    if address is not None:
        ipaddress.ip_address(address)
    port = data.get("IpPort")
    port = _unsigned(port, 65535, 5) if port is not None and port not in ("-", "") else None
    return {
        "timestamp": timestamp,
        "event_type": "windows_security",
        "source_type": "windows_security",
        "severity": "info",
        "signature": f"Windows Security event {event_id}",
        "signature_id": str(event_id),
        "category": "windows_security",
        "hostname": _optional_text(winlog.get("computer_name")),
        "username": _optional_text(data.get("TargetUserName")),
        "domain": _optional_text(data.get("TargetDomainName")),
        "source_ip": address,
        "source_port": port,
        "raw_data": raw,
    }
