"""Event parsers for normalizing telemetry from different sources."""

from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log

__all__ = ["parse_suricata_eve", "parse_zeek_log"]
