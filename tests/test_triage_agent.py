"""Tests for Triage Agent — correlation logic and case creation."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone, timedelta

from backend.services.agents.triage import TriageAgent


class TestCorrelationGrouping:
    """Test the rule-based correlation logic (no LLM needed)."""

    def _make_alert(self, id=1, severity="high", asset_id=1, title="Test Alert", cve_id=None, cvss=7.5):
        alert = MagicMock()
        alert.id = id
        alert.severity = severity
        alert.asset_id = asset_id
        alert.title = title
        alert.cve_id = cve_id
        alert.cvss_score = cvss
        alert.created_at = datetime.now(timezone.utc)
        return alert

    def _make_event(self, id=1, severity="medium", src_ip="10.0.0.5", dst_ip="192.168.1.100",
                    event_type="alert", signature=None, category=None, src_port=None, dst_port=None):
        event = MagicMock()
        event.id = id
        event.severity = severity
        event.source_ip = src_ip
        event.dest_ip = dst_ip
        event.source_port = src_port
        event.dest_port = dst_port
        event.event_type = event_type
        event.signature = signature
        event.category = category
        event.timestamp = datetime.now(timezone.utc)
        event.processed = "pending"
        return event

    def test_group_alerts_by_asset(self):
        """Alerts on same asset should group together."""
        agent = TriageAgent.__new__(TriageAgent)
        alerts = [
            self._make_alert(id=1, asset_id=5),
            self._make_alert(id=2, asset_id=5),
            self._make_alert(id=3, asset_id=10),
        ]
        groups = agent._group_by_correlation(alerts, [])
        # 2 groups: asset_5 and asset_10
        assert len(groups) == 2

    def test_group_events_by_ip(self):
        """Events with overlapping IPs should group together."""
        agent = TriageAgent.__new__(TriageAgent)
        events = [
            self._make_event(id=1, src_ip="10.0.0.5", dst_ip="192.168.1.100", severity="high"),
            self._make_event(id=2, src_ip="10.0.0.5", dst_ip="10.0.0.6", severity="medium"),
        ]
        groups = agent._group_by_correlation([], events)
        # Should be 1 group (10.0.0.5 links them)
        assert len(groups) >= 1

    def test_filter_info_only_events(self):
        """Groups with only info-level events and no alerts should be filtered out."""
        agent = TriageAgent.__new__(TriageAgent)
        events = [
            self._make_event(id=1, severity="info", src_ip="1.1.1.1"),
        ]
        groups = agent._group_by_correlation([], events)
        assert len(groups) == 0


class TestRuleBasedFallback:
    """Test the rule-based triage fallback (when LLM is unavailable)."""

    def _make_alert(self, **kwargs):
        return TestCorrelationGrouping._make_alert(self, **kwargs)

    def _make_event(self, **kwargs):
        return TestCorrelationGrouping._make_event(self, **kwargs)

    def test_fallback_uses_highest_severity(self):
        agent = TriageAgent.__new__(TriageAgent)
        alerts = [self._make_alert(severity="critical")]
        events = [self._make_event(severity="low")]
        result = agent._rule_based_fallback(alerts, events)
        assert result["severity"] == "critical"
        assert result["is_incident"] is True
        assert result["confidence"] == 0.4

    def test_fallback_with_no_alerts(self):
        agent = TriageAgent.__new__(TriageAgent)
        events = [self._make_event(severity="high", signature="Port Scan Detected")]
        result = agent._rule_based_fallback([], events)
        assert "Port Scan" in result["title"]

    def test_fallback_always_returns_incident(self):
        agent = TriageAgent.__new__(TriageAgent)
        result = agent._rule_based_fallback([], [self._make_event(severity="medium")])
        assert result["is_incident"] is True


class TestBuildLLMContext:
    """Test context building for LLM."""

    def _make_alert(self, **kwargs):
        return TestCorrelationGrouping._make_alert(self, **kwargs)

    def _make_event(self, **kwargs):
        return TestCorrelationGrouping._make_event(self, **kwargs)

    def test_context_includes_alerts(self):
        agent = TriageAgent.__new__(TriageAgent)
        alerts = [self._make_alert(title="CVE-2024-1234", severity="critical", cve_id="CVE-2024-1234")]
        context = agent._build_llm_context(alerts, [])
        assert "ALERTS" in context
        assert "CVE-2024-1234" in context
        assert "critical" in context

    def test_context_includes_events(self):
        agent = TriageAgent.__new__(TriageAgent)
        events = [self._make_event(src_ip="10.0.0.5", dst_ip="192.168.1.100", signature="ET SCAN")]
        context = agent._build_llm_context([], events)
        assert "EVENTS" in context
        assert "10.0.0.5" in context
        assert "ET SCAN" in context

    def test_context_truncates_large_sets(self):
        agent = TriageAgent.__new__(TriageAgent)
        alerts = [self._make_alert(id=i) for i in range(50)]
        context = agent._build_llm_context(alerts, [])
        # Should only include first 20
        lines = [l for l in context.split("\n") if l.startswith("-")]
        assert len(lines) <= 20
