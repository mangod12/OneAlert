"""Tests for Detect Agent — rule-based detection logic."""
import pytest
from backend.services.agents.detect import DetectAgent


class TestRuleBasedDetection:
    def _make_agent(self):
        return DetectAgent.__new__(DetectAgent)

    def test_high_volume_ip_detected(self):
        agent = self._make_agent()
        stats = {
            "total_events": 100,
            "alert_events": 5,
            "top_source_ips": {"10.0.0.5": 75, "10.0.0.1": 10},
            "top_dest_ports": {},
            "severity_distribution": {"info": 90, "medium": 10},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        assert any("10.0.0.5" in f["title"] for f in findings)

    def test_ot_port_modbus_detected(self):
        agent = self._make_agent()
        stats = {
            "total_events": 50,
            "alert_events": 0,
            "top_source_ips": {},
            "top_dest_ports": {502: 15, 80: 100},
            "severity_distribution": {"info": 50},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        modbus_findings = [f for f in findings if "Modbus" in f["title"]]
        assert len(modbus_findings) == 1
        assert modbus_findings[0]["severity"] == "high"

    def test_ot_port_s7comm_detected(self):
        agent = self._make_agent()
        stats = {
            "total_events": 20,
            "alert_events": 0,
            "top_source_ips": {},
            "top_dest_ports": {102: 5},
            "severity_distribution": {},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        assert any("S7comm" in f["title"] for f in findings)

    def test_elevated_severity_alert(self):
        agent = self._make_agent()
        stats = {
            "total_events": 100,
            "alert_events": 10,
            "top_source_ips": {"10.0.0.5": 10},
            "top_dest_ports": {},
            "severity_distribution": {"critical": 3, "high": 5, "medium": 2},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        elevated = [f for f in findings if "Elevated" in f["title"]]
        assert len(elevated) == 1

    def test_no_findings_for_normal_traffic(self):
        agent = self._make_agent()
        stats = {
            "total_events": 20,
            "alert_events": 0,
            "top_source_ips": {"10.0.0.1": 10, "10.0.0.2": 10},
            "top_dest_ports": {80: 15, 443: 5},
            "severity_distribution": {"info": 20},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        assert len(findings) == 0

    def test_dnp3_port_detected(self):
        agent = self._make_agent()
        stats = {
            "total_events": 10,
            "alert_events": 0,
            "top_source_ips": {},
            "top_dest_ports": {20000: 3},
            "severity_distribution": {},
            "top_signatures": {},
        }
        findings = agent._rule_based_detection(stats)
        assert any("DNP3" in f["title"] for f in findings)
