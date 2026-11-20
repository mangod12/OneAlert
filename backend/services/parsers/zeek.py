"""Zeek log parser → normalized SecurityEvent dicts."""

import re
from datetime import datetime

from backend.services.parsers.event_time import observed_timestamp


def _zeek_ts(ts_val) -> datetime:
    """Convert Zeek timestamp (epoch float or ISO string) to datetime."""
    return observed_timestamp(ts_val, epoch_allowed=True)


def parse_zeek_log(raw: dict) -> dict | None:
    """Parse a single Zeek JSON log entry into normalized format.

    Handles: conn.log, dns.log, http.log, ssl.log, files.log, notice.log.
    Uses '_path' field (set by Zeek JSON Streaming Logs) to determine log type.
    Returns None if event cannot be parsed.
    """
    log_type = raw.get("_path", raw.get("log_type", "unknown"))
    ts = _zeek_ts(raw.get("ts"))

    base = {
        "timestamp": ts,
        "event_type": log_type,
        "source_ip": raw.get("id.orig_h") or raw.get("id_orig_h"),
        "source_port": _safe_int(raw.get("id.orig_p", raw.get("id_orig_p"))),
        "dest_ip": raw.get("id.resp_h") or raw.get("id_resp_h"),
        "dest_port": _safe_int(raw.get("id.resp_p", raw.get("id_resp_p"))),
        "protocol": (raw.get("proto") or "").lower(),
        "source_type": "zeek",
        "severity": "info",
        "raw_data": raw,
    }

    if log_type == "conn":
        base.update({
            "bytes_in": _safe_int(raw.get("resp_bytes")),
            "bytes_out": _safe_int(raw.get("orig_bytes")),
            "category": "network_connection",
            "action": raw.get("conn_state"),
        })

    elif log_type == "dns":
        base.update({
            "domain": raw.get("query"),
            "category": f"dns_{raw.get('qtype_name', 'query').lower()}",
        })

    elif log_type == "http":
        base.update({
            "hostname": raw.get("host"),
            "url": raw.get("uri"),
            "user_agent": raw.get("user_agent"),
            "category": f"http_{(raw.get('method') or 'GET').lower()}",
        })

    elif log_type == "ssl":
        base.update({
            "hostname": raw.get("server_name"),
            "category": "tls_handshake",
        })

    elif log_type == "files":
        base.update({
            "category": "file_transfer",
            "signature": raw.get("mime_type"),
        })

    elif log_type == "notice":
        base.update({
            "severity": _notice_severity(raw.get("note", "")),
            "signature": raw.get("note"),
            "category": "zeek_notice",
            "hostname": raw.get("sub") or raw.get("msg"),
        })

    else:
        base["category"] = f"zeek_{log_type}"

    return base


def _safe_int(val) -> int | None:
    if val is None or val == "-":
        return None
    if type(val) is int:
        return val
    if isinstance(val, str) and re.fullmatch(r"[+-]?[0-9]+", val.strip()):
        return int(val)
    raise ValueError("Zeek integer field must be an integer or decimal integer string")


def _notice_severity(note: str) -> str:
    """Map Zeek notice types to severity levels."""
    high_notices = {"Scan::Port_Scan", "SSL::Invalid_Server_Cert", "TeamCymruMalwareHashRegistry::Match"}
    critical_notices = {"Intel::Notice", "Signatures::Sensitive_Signature"}

    if note in critical_notices:
        return "critical"
    if note in high_notices:
        return "high"
    if "scan" in note.lower() or "attack" in note.lower():
        return "medium"
    return "low"
