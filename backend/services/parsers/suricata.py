"""Suricata EVE JSON parser → normalized SecurityEvent dicts."""

from datetime import datetime, timezone
from typing import Optional


SEVERITY_MAP = {1: "critical", 2: "high", 3: "medium", 4: "low"}


def parse_suricata_eve(raw: dict) -> Optional[dict]:
    """Parse a single Suricata EVE JSON event into normalized format.

    Handles event_type: alert, dns, http, flow, tls, fileinfo.
    Returns None if event cannot be parsed.
    """
    event_type = raw.get("event_type", "unknown")
    timestamp_str = raw.get("timestamp")

    if not timestamp_str:
        return None

    try:
        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        ts = datetime.now(timezone.utc)

    base = {
        "timestamp": ts,
        "event_type": event_type,
        "source_ip": raw.get("src_ip"),
        "source_port": raw.get("src_port"),
        "dest_ip": raw.get("dest_ip"),
        "dest_port": raw.get("dest_port"),
        "protocol": (raw.get("proto") or "").lower(),
        "source_type": "suricata",
        "raw_data": raw,
    }

    if event_type == "alert":
        alert = raw.get("alert", {})
        severity_num = alert.get("severity", 3)
        base.update({
            "severity": SEVERITY_MAP.get(severity_num, "medium"),
            "signature": alert.get("signature"),
            "signature_id": str(alert.get("signature_id", "")),
            "category": alert.get("category"),
            "action": alert.get("action", "allowed"),
        })

    elif event_type == "dns":
        dns = raw.get("dns", {})
        base.update({
            "severity": "info",
            "domain": dns.get("rrname"),
            "category": f"dns_{dns.get('type', 'query')}",
        })

    elif event_type == "http":
        http = raw.get("http", {})
        base.update({
            "severity": "info",
            "hostname": http.get("hostname"),
            "url": http.get("url"),
            "user_agent": http.get("http_user_agent"),
            "category": f"http_{http.get('http_method', 'GET').lower()}",
        })

    elif event_type == "flow":
        base.update({
            "severity": "info",
            "bytes_in": raw.get("flow", {}).get("bytes_toclient"),
            "bytes_out": raw.get("flow", {}).get("bytes_toserver"),
            "category": "network_flow",
        })

    elif event_type == "tls":
        tls = raw.get("tls", {})
        base.update({
            "severity": "info",
            "hostname": tls.get("sni"),
            "category": "tls_handshake",
        })

    else:
        base["severity"] = "info"
        base["category"] = event_type

    return base
