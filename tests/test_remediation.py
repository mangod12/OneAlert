"""Tests for the rule-based remediation engine."""

import pytest
from unittest.mock import MagicMock

from backend.services.remediation_engine import generate_remediations


def _make_alert(**kwargs):
    """Create a mock alert object with given attributes."""
    alert = MagicMock()
    alert.remediation = kwargs.get('remediation', None)
    alert.source_url = kwargs.get('source_url', '')
    alert.severity = kwargs.get('severity', 'medium')
    alert.cve_id = kwargs.get('cve_id', 'CVE-2024-1234')
    return alert


def _make_asset(**kwargs):
    """Create a mock asset object with given attributes."""
    asset = MagicMock()
    asset.is_ot_asset = kwargs.get('is_ot_asset', False)
    asset.network_zone = kwargs.get('network_zone', 'it')
    asset.primary_protocol = kwargs.get('primary_protocol', 'https')
    return asset


class TestRemediationEngine:
    """Test cases for the remediation engine rules."""

    def test_non_ot_asset_with_patch_suggests_patch(self):
        """Rule 1: Non-OT asset with patch available suggests direct patch."""
        alert = _make_alert(remediation="Update to version 2.1.0")
        asset = _make_asset(is_ot_asset=False, network_zone='it')

        actions = generate_remediations(alert, asset)

        # Should have patch + accept_risk
        assert len(actions) >= 2
        assert actions[0]['action_type'] == 'patch'
        assert actions[0]['priority'] == 1
        assert 'Update to version 2.1.0' in actions[0]['description']
        assert actions[0]['ai_confidence'] == 0.95
        assert actions[0]['requires_maintenance_window'] is False

    def test_ot_asset_control_zone_with_patch_suggests_compensating_control(self):
        """Rule 2: OT asset in control zone suggests compensating control first."""
        alert = _make_alert(remediation="Apply firmware patch v3.2")
        asset = _make_asset(
            is_ot_asset=True,
            network_zone='control',
            primary_protocol='modbus'
        )

        actions = generate_remediations(alert, asset)

        # First action should be compensating control
        compensating = [a for a in actions if a['action_type'] == 'compensating_control']
        assert len(compensating) >= 1
        assert 'control zone' in compensating[0]['description']
        assert compensating[0]['requires_maintenance_window'] is False

        # Patch should be there but with maintenance window
        patches = [a for a in actions if a['action_type'] == 'patch']
        assert len(patches) >= 1
        maintenance_patch = [p for p in patches if p['requires_maintenance_window']]
        assert len(maintenance_patch) >= 1
        assert 'maintenance window' in maintenance_patch[0]['description']

    def test_cisa_kev_critical_suggests_immediate_isolation(self):
        """Rule 3: CISA KEV source with critical severity suggests isolation at priority 1."""
        alert = _make_alert(
            source_url='https://www.cisa.gov/known-exploited-vulnerabilities',
            severity='critical',
            remediation='Apply patch KB12345'
        )
        asset = _make_asset(is_ot_asset=False, network_zone='it')

        actions = generate_remediations(alert, asset)

        # First action should be network segmentation with KEV urgency
        assert actions[0]['action_type'] == 'network_segmentation'
        assert actions[0]['priority'] == 1
        assert 'CISA KEV' in actions[0]['description']
        assert actions[0]['ai_confidence'] == 0.98

    def test_unencrypted_protocol_suggests_vpn_overlay(self):
        """Rule 4: Unencrypted protocol suggests VPN overlay."""
        alert = _make_alert(severity='medium')
        asset = _make_asset(
            is_ot_asset=True,
            network_zone='supervisory',
            primary_protocol='modbus'
        )

        actions = generate_remediations(alert, asset)

        # Should contain network_segmentation for unencrypted protocol
        vpn_actions = [
            a for a in actions
            if a['action_type'] == 'network_segmentation'
            and 'unencrypted' in a['description'].lower()
        ]
        assert len(vpn_actions) >= 1
        assert 'VPN overlay' in vpn_actions[0]['description']
        assert vpn_actions[0]['requires_maintenance_window'] is True
        assert vpn_actions[0]['estimated_downtime_minutes'] == 120

    def test_always_includes_accept_risk_as_last(self):
        """Rule 5: Always includes accept_risk as the lowest priority option."""
        alert = _make_alert(severity='low')
        asset = _make_asset()

        actions = generate_remediations(alert, asset)

        assert len(actions) >= 1
        last_action = actions[-1]
        assert last_action['action_type'] == 'accept_risk'
        assert last_action['ai_confidence'] == 0.50
        assert 'risk acceptance' in last_action['description']

    def test_no_patch_no_kev_minimal_remediations(self):
        """Without patch or KEV, only accept_risk is generated (plus protocol if applicable)."""
        alert = _make_alert(severity='medium', remediation=None, source_url='')
        asset = _make_asset(
            is_ot_asset=False,
            network_zone='it',
            primary_protocol='https'
        )

        actions = generate_remediations(alert, asset)

        # Only accept_risk
        assert len(actions) == 1
        assert actions[0]['action_type'] == 'accept_risk'

    def test_field_zone_treated_as_critical(self):
        """Field zone should be treated as critical zone (compensating control)."""
        alert = _make_alert(remediation="Update firmware to v4.0")
        asset = _make_asset(
            is_ot_asset=True,
            network_zone='field',
            primary_protocol='dnp3'
        )

        actions = generate_remediations(alert, asset)

        compensating = [a for a in actions if a['action_type'] == 'compensating_control']
        assert len(compensating) >= 1
        assert 'field zone' in compensating[0]['description']

    def test_safety_system_zone_treated_as_critical(self):
        """Safety system zone should be treated as critical zone."""
        alert = _make_alert(remediation="Apply security update")
        asset = _make_asset(
            is_ot_asset=True,
            network_zone='safety_system',
            primary_protocol='profinet'
        )

        actions = generate_remediations(alert, asset)

        compensating = [a for a in actions if a['action_type'] == 'compensating_control']
        assert len(compensating) >= 1
        assert 'safety_system zone' in compensating[0]['description']

    def test_null_asset_handled_gracefully(self):
        """Engine should handle None asset gracefully."""
        alert = _make_alert(severity='high', remediation='Patch available')

        actions = generate_remediations(alert, None)

        # Should still produce patch + accept_risk (no OT logic triggered)
        assert len(actions) >= 2
        assert actions[0]['action_type'] == 'patch'
        assert actions[-1]['action_type'] == 'accept_risk'

    def test_kev_in_source_url_case_insensitive(self):
        """KEV detection should be case insensitive."""
        alert = _make_alert(
            source_url='https://KEV.CISA.GOV/catalog',
            severity='high',
            remediation='Apply patch'
        )
        asset = _make_asset()

        actions = generate_remediations(alert, asset)

        kev_actions = [a for a in actions if 'CISA KEV' in a.get('description', '')]
        assert len(kev_actions) >= 1
