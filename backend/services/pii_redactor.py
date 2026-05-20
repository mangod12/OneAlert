"""PII and secret redaction pipeline for event data before LLM processing."""

import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Patterns to redact (compiled for performance)
_PATTERNS: list[tuple[str, re.Pattern, str]] = [
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[REDACTED_EMAIL]"),
    ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]"),
    ("credit_card", re.compile(r"\b(?:\d[ -]*?){13,16}\b"), "[REDACTED_CC]"),
    ("api_key", re.compile(
        r"\b(?:sk|pk|api|key|token|secret|bearer|aws|AKIA)[_\-]?(?:[A-Za-z0-9]+[_\-]?){1,5}[A-Za-z0-9]{8,64}\b",
        re.IGNORECASE,
    ), "[REDACTED_API_KEY]"),
    ("bearer_token", re.compile(
        r"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*",
    ), "Bearer [REDACTED_TOKEN]"),
    ("password_field", re.compile(
        r'(?i)(?:password|passwd|pwd|secret|credential)\s*[=:]\s*\S+',
    ), "[REDACTED_CREDENTIAL]"),
    ("private_key", re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
    ), "[REDACTED_PRIVATE_KEY]"),
    ("jwt", re.compile(
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b",
    ), "[REDACTED_JWT]"),
]

# Fields that should NEVER be redacted (network observables needed for security analysis)
PRESERVE_FIELDS = {"source_ip", "dest_ip", "src_ip", "dst_ip", "src_port", "dest_port",
                   "hostname", "domain", "url", "uri", "dns_query", "signature",
                   "alert_signature", "protocol", "event_type", "category", "severity",
                   "sensor", "interface", "vlan", "mac_address"}


def redact_string(value: str) -> tuple[str, int]:
    """Redact PII/secrets from a string value.

    Returns: (redacted_string, redaction_count)
    """
    count = 0
    result = value
    for name, pattern, replacement in _PATTERNS:
        new_result, n = pattern.subn(replacement, result)
        if n > 0:
            count += n
            result = new_result
            logger.debug(f"Redacted {n} {name} pattern(s)")
    return result, count


def redact_dict(data: dict[str, Any], preserve_keys: set[str] | None = None) -> tuple[dict, int]:
    """Recursively redact PII/secrets from a dictionary.

    Args:
        data: Dictionary to redact
        preserve_keys: Field names to skip (default: PRESERVE_FIELDS)

    Returns: (redacted_dict, total_redaction_count)
    """
    safe_keys = preserve_keys if preserve_keys is not None else PRESERVE_FIELDS
    total = 0
    result = {}

    for key, value in data.items():
        if key in safe_keys:
            result[key] = value
        elif isinstance(value, str):
            redacted, count = redact_string(value)
            result[key] = redacted
            total += count
        elif isinstance(value, dict):
            redacted, count = redact_dict(value, safe_keys)
            result[key] = redacted
            total += count
        elif isinstance(value, list):
            redacted_list = []
            for item in value:
                if isinstance(item, dict):
                    r, c = redact_dict(item, safe_keys)
                    redacted_list.append(r)
                    total += c
                elif isinstance(item, str):
                    r, c = redact_string(item)
                    redacted_list.append(r)
                    total += c
                else:
                    redacted_list.append(item)
            result[key] = redacted_list
        else:
            result[key] = value

    return result, total


def redact_event_for_llm(event_data: dict[str, Any]) -> dict[str, Any]:
    """Redact an event before sending to LLM for analysis.

    Preserves network observables (IPs, ports, domains) needed for security analysis
    while removing PII and secrets.
    """
    redacted, count = redact_dict(event_data)
    if count > 0:
        logger.info(f"Redacted {count} sensitive value(s) from event before LLM processing")
        redacted["_redaction_count"] = count
    return redacted
