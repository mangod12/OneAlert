"""Zeek log parser → normalized SecurityEvent dicts."""

from datetime import datetime, timezone
from typing import Optional


def _zeek_ts(ts_val) -> datetime:
    """Convert Zeek timestamp (epoch float or ISO string) to datetime."""
    if isinstance(ts_val, (int, float)):
        return datetime.fromtimestamp(ts_val, tz=timezone.utc)
    if isinstance(ts_val, str):
        try:
            return datetime.fromtimestamp(float(ts_val), tz=timezone.utc)
        except ValueError:
            return datetime.fromisoformat(ts_val.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def parse_zeek_log(raw: dict) -> Optional[dict]:
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
        "source_port": _safe_int(raw.get("id.orig_p") or raw.get("id_orig_p")),
        "dest_ip": raw.get("id.resp_h") or raw.get("id_resp_h"),
        "dest_port": _safe_int(raw.get("id.resp_p") or raw.get("id_resp_p")),
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


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


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
