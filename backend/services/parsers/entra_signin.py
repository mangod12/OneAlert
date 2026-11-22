"""Normalize explicitly selected Microsoft Graph user sign-in records.

Contracts: Microsoft Graph v1.0 signIn, signInStatus and list signIns resources.
Uploaded labels and status codes are not independently authenticated verdicts.
"""

import ipaddress

from backend.services.parsers.event_time import observed_timestamp


def _text(value, *, optional=False, limit=1024):
    if optional and (value is None or (isinstance(value, str) and not value.strip())):
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Entra used text field must be bounded nonempty text")
    return value


def parse_entra_signin(raw: dict) -> dict | None:
    # Do not reinterpret directory audits, Azure Monitor wrappers, generic
    # identity events or arbitrary Graph collections as user sign-in records.
    if not {"id", "appId", "status"}.issubset(raw):
        return None
    _text(raw["id"], limit=512)
    application_id = _text(raw["appId"], limit=512)
    timestamp = observed_timestamp(raw.get("createdDateTime"))
    status = raw["status"]
    if not isinstance(status, dict):
        raise ValueError("Entra sign-in status must be an object")
    code = status.get("errorCode")
    if type(code) is not int or not 0 <= code <= 2147483647:
        raise ValueError("Entra recorded error code must be a nonnegative Int32")
    application = _text(raw.get("appDisplayName"), optional=True) or application_id
    username = _text(raw.get("userPrincipalName"), optional=True)
    address = _text(raw.get("ipAddress"), optional=True, limit=128)
    if address is not None:
        # Graph documents an IP address, not an arbitrary hostname or a URL.
        # Reject a bad used endpoint rather than guessing from another field.
        ipaddress.ip_address(address)
        if "%" in address:
            raise ValueError("Entra sign-in IP address must not contain an interface zone")
    return {
        "timestamp": timestamp,
        "event_type": "entra_signin",
        "source_type": "entra_signin",
        "severity": "info",
        "signature": f"Entra sign-in: {application}",
        "category": "identity_signin",
        "action": f"recorded_error_code:{code}",
        "username": username,
        "source_ip": address,
        "raw_data": raw,
    }
