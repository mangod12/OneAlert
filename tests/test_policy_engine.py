"""Tests for policy engine — autonomy levels and OT zone restrictions."""
import pytest
from backend.services.policy_engine import check_action_approval, list_autonomy_levels


class TestAutonomyLevels:
    def test_l0_approves_nothing(self):
        result = check_action_approval("notify", "L0")
        assert result["approved"] is False

    def test_l1_approves_notify(self):
        result = check_action_approval("notify", "L1")
        assert result["approved"] is True

    def test_l1_rejects_block_ip(self):
        result = check_action_approval("block_ip", "L1")
        assert result["approved"] is False
        assert result["requires_human"] is True

    def test_l3_approves_block_ip(self):
        result = check_action_approval("block_ip", "L3")
        assert result["approved"] is True

    def test_l4_approves_disable_user(self):
        result = check_action_approval("disable_user", "L4")
        assert result["approved"] is True


class TestOTZoneRestrictions:
    def test_ot_control_zone_always_requires_approval(self):
        result = check_action_approval("block_ip", "L4", asset_zone="control", asset_is_ot=True)
        assert result["approved"] is False
        assert "OT asset" in result["reason"]

    def test_ot_field_zone_blocks_isolate(self):
        result = check_action_approval("isolate_host", "L4", asset_zone="field", asset_is_ot=True)
        assert result["approved"] is False

    def test_ot_safety_system_blocks_disable_user(self):
        result = check_action_approval("disable_user", "L4", asset_zone="safety_system", asset_is_ot=True)
        assert result["approved"] is False

    def test_it_zone_allows_at_l3(self):
        result = check_action_approval("block_ip", "L3", asset_zone="it", asset_is_ot=False)
        assert result["approved"] is True

    def test_non_ot_not_restricted(self):
        result = check_action_approval("block_ip", "L3", asset_zone="control", asset_is_ot=False)
        assert result["approved"] is True


class TestAlwaysRequireApproval:
    def test_isolate_host_always_needs_approval(self):
        result = check_action_approval("isolate_host", "L4")
        assert result["approved"] is False
        assert result["requires_human"] is True

    def test_rotate_secret_always_needs_approval(self):
        result = check_action_approval("rotate_secret", "L4")
        assert result["approved"] is False

    def test_quarantine_vlan_always_needs_approval(self):
        result = check_action_approval("quarantine_vlan", "L4")
        assert result["approved"] is False


class TestListLevels:
    def test_list_all_levels(self):
        levels = list_autonomy_levels()
        assert len(levels) == 5
        assert levels[0]["level"] == "L0"
        assert levels[4]["level"] == "L4"
