"""Tests for security event ingestion, parsers, and API."""
import pytest

from backend.services.parsers.suricata import parse_suricata_eve
from backend.services.parsers.zeek import parse_zeek_log


# --- Suricata Parser Tests ---

class TestSuricataParser:
    def test_parse_alert(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00.000000+0000",
            "event_type": "alert",
            "src_ip": "10.0.0.5",
            "src_port": 54321,
            "dest_ip": "192.168.1.100",
            "dest_port": 502,
            "proto": "TCP",
            "alert": {
                "signature": "ET EXPLOIT Modbus TCP Function Code - Write Single Coil",
                "signature_id": 2024001,
                "severity": 1,
                "category": "Attempted Admin Privilege Gain",
                "action": "allowed",
            },
        }
        result = parse_suricata_eve(raw)
        assert result["event_type"] == "alert"
        assert result["severity"] == "critical"
        assert result["signature"] == "ET EXPLOIT Modbus TCP Function Code - Write Single Coil"
        assert result["source_ip"] == "10.0.0.5"
        assert result["dest_port"] == 502
        assert result["source_type"] == "suricata"

    def test_parse_dns(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "dns",
            "src_ip": "10.0.0.5",
            "dest_ip": "8.8.8.8",
            "dns": {"type": "query", "rrname": "evil.example.com"},
        }
        result = parse_suricata_eve(raw)
        assert result["domain"] == "evil.example.com"
        assert result["severity"] == "info"

    def test_parse_http(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "http",
            "src_ip": "10.0.0.5",
            "dest_ip": "93.184.216.34",
            "http": {"hostname": "example.com", "url": "/login", "http_method": "POST"},
        }
        result = parse_suricata_eve(raw)
        assert result["hostname"] == "example.com"
        assert result["url"] == "/login"

    def test_parse_flow(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "flow",
            "src_ip": "10.0.0.5",
            "dest_ip": "10.0.0.6",
            "flow": {"bytes_toclient": 1024, "bytes_toserver": 2048},
        }
        result = parse_suricata_eve(raw)
        assert result["bytes_in"] == 1024
        assert result["bytes_out"] == 2048

    def test_no_timestamp_returns_none(self):
        assert parse_suricata_eve({}) is None

    def test_tls_event(self):
        raw = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "tls",
            "tls": {"sni": "badsite.com"},
        }
        result = parse_suricata_eve(raw)
        assert result["hostname"] == "badsite.com"
        assert result["category"] == "tls_handshake"


# --- Zeek Parser Tests ---

class TestZeekParser:
    def test_parse_conn(self):
        raw = {
            "_path": "conn",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.orig_p": 54321,
            "id.resp_h": "192.168.1.100",
            "id.resp_p": 80,
            "proto": "tcp",
            "orig_bytes": 500,
            "resp_bytes": 3000,
            "conn_state": "SF",
        }
        result = parse_zeek_log(raw)
        assert result["event_type"] == "conn"
        assert result["source_ip"] == "10.0.0.5"
        assert result["bytes_out"] == 500
        assert result["bytes_in"] == 3000
        assert result["source_type"] == "zeek"

    def test_parse_dns(self):
        raw = {
            "_path": "dns",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.resp_h": "8.8.8.8",
            "query": "c2.evil.com",
            "qtype_name": "A",
        }
        result = parse_zeek_log(raw)
        assert result["domain"] == "c2.evil.com"

    def test_parse_http(self):
        raw = {
            "_path": "http",
            "ts": 1716192000.0,
            "id.orig_h": "10.0.0.5",
            "id.resp_h": "93.184.216.34",
            "host": "example.com",
            "uri": "/api/exfil",
            "method": "POST",
            "user_agent": "curl/7.68",
        }
        result = parse_zeek_log(raw)
        assert result["hostname"] == "example.com"
        assert result["url"] == "/api/exfil"
        assert result["user_agent"] == "curl/7.68"

    def test_parse_notice(self):
        raw = {
            "_path": "notice",
            "ts": 1716192000.0,
            "note": "Scan::Port_Scan",
            "msg": "Port scan detected from 10.0.0.5",
        }
        result = parse_zeek_log(raw)
        assert result["severity"] == "high"
        assert result["signature"] == "Scan::Port_Scan"

    def test_parse_ssl(self):
        raw = {
            "_path": "ssl",
            "ts": 1716192000.0,
            "server_name": "secure.example.com",
        }
        result = parse_zeek_log(raw)
        assert result["hostname"] == "secure.example.com"
        assert result["category"] == "tls_handshake"

    def test_alt_field_names(self):
        """Zeek JSON can use _ instead of . in field names."""
        raw = {
            "_path": "conn",
            "ts": 1716192000.0,
            "id_orig_h": "10.0.0.1",
            "id_orig_p": 12345,
            "id_resp_h": "10.0.0.2",
            "id_resp_p": 443,
        }
        result = parse_zeek_log(raw)
        assert result["source_ip"] == "10.0.0.1"
        assert result["dest_ip"] == "10.0.0.2"


# --- Additional Parser Tests ---

class TestPassthroughAndEdgeCases:
    """Additional parser edge case tests."""

    def test_suricata_unknown_event_type(self):
        raw = {"timestamp": "2026-05-20T10:00:00Z", "event_type": "custom_event"}
        result = parse_suricata_eve(raw)
        assert result["category"] == "custom_event"
        assert result["severity"] == "info"

    def test_zeek_unknown_log_type(self):
        raw = {"_path": "custom_log", "ts": 1716192000.0}
        result = parse_zeek_log(raw)
        assert result["category"] == "zeek_custom_log"
