"""Tests for MITRE ATT&CK integration."""
import pytest
from backend.services.mitre.attack_data import (
    get_tactic, get_technique, search_techniques,
    map_signature_to_techniques, compute_coverage,
    TACTICS, TECHNIQUES,
)


class TestTactics:
    def test_get_valid_tactic(self):
        t = get_tactic("TA0001")
        assert t["name"] == "Initial Access"
        assert t["id"] == "TA0001"

    def test_get_invalid_tactic(self):
        assert get_tactic("TA9999") is None

    def test_ics_tactics_present(self):
        assert "TA0107" in TACTICS
        assert TACTICS["TA0107"]["name"] == "Impair Process Control"


class TestTechniques:
    def test_get_valid_technique(self):
        t = get_technique("T1078")
        assert t["name"] == "Valid Accounts"
        assert "TA0001" in t["tactics"]

    def test_get_invalid_technique(self):
        assert get_technique("T9999") is None

    def test_ics_techniques_present(self):
        assert "T0855" in TECHNIQUES
        assert "Unauthorized Command" in TECHNIQUES["T0855"]["name"]


class TestSearch:
    def test_search_by_keyword(self):
        results = search_techniques("port scan")
        ids = [r["id"] for r in results]
        assert "T1046" in ids

    def test_search_modbus(self):
        results = search_techniques("modbus")
        ids = [r["id"] for r in results]
        assert "T0855" in ids  # Unauthorized Command Message

    def test_search_rdp(self):
        results = search_techniques("rdp")
        ids = [r["id"] for r in results]
        assert "T1021.001" in ids

    def test_search_no_results(self):
        results = search_techniques("xyznonexistent123")
        assert results == []

    def test_search_by_name(self):
        results = search_techniques("Brute Force")
        ids = [r["id"] for r in results]
        assert "T1110" in ids


class TestSignatureMapping:
    def test_map_suricata_scan(self):
        results = map_signature_to_techniques("ET SCAN Nmap SYN Scan")
        ids = [r["id"] for r in results]
        assert "T1046" in ids

    def test_map_modbus_exploit(self):
        results = map_signature_to_techniques("ET EXPLOIT Modbus Write Coil")
        ids = [r["id"] for r in results]
        assert "T0855" in ids or "T0836" in ids

    def test_map_empty_signature(self):
        assert map_signature_to_techniques("") == []
        assert map_signature_to_techniques(None) == []


class TestCoverage:
    def test_full_coverage_computation(self):
        detected = {"T1078", "T1190", "T1046"}
        result = compute_coverage(detected)
        assert result["total_techniques"] == len(TECHNIQUES)
        assert result["covered_techniques"] == 3
        assert result["coverage_percentage"] > 0
        assert "by_tactic" in result

    def test_empty_coverage(self):
        result = compute_coverage(set())
        assert result["covered_techniques"] == 0
        assert result["coverage_percentage"] == 0

    def test_tactic_breakdown(self):
        detected = {"T1046"}  # Network Service Discovery → TA0007
        result = compute_coverage(detected)
        assert result["by_tactic"]["TA0007"]["covered"] >= 1
