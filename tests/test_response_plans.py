"""Tests for response plan endpoints and action executor."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone

from backend.services.action_executor import execute_response_plan
from backend.services.policy_engine import check_action_approval, list_autonomy_levels


class TestActionExecutor:
    """Test response action execution engine."""

    @pytest.mark.asyncio
    async def test_execute_notify_action(self):
        """Notify action should succeed."""
        plan = MagicMock()
        plan.id = 1
        plan.status = "approved"
        plan.actions = [
            {"action_type": "notify", "target": "soc-team", "reason": "New incident", "priority": 1}
        ]

        db = AsyncMock()
        result = await execute_response_plan(db=db, plan=plan)

        assert result["succeeded"] == 1
        assert result["failed"] == 0
        assert result["status"] in ("completed", "partial")
        assert len(result["results"]) == 1
        assert result["results"][0]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_execute_multiple_actions_in_priority_order(self):
        """Actions execute in priority order."""
        plan = MagicMock()
        plan.id = 2
        plan.status = "approved"
        plan.actions = [
            {"action_type": "block_ip", "target": "10.0.0.5", "reason": "Suspicious", "priority": 3},
            {"action_type": "notify", "target": "soc", "reason": "Alert", "priority": 1},
            {"action_type": "snapshot_logs", "target": "server-01", "reason": "Evidence", "priority": 2},
        ]

        db = AsyncMock()
        result = await execute_response_plan(db=db, plan=plan)

        assert result["succeeded"] == 3
        assert result["failed"] == 0
        # Verify priority ordering
        assert result["results"][0]["action"] == "notify"
        assert result["results"][1]["action"] == "snapshot_logs"
        assert result["results"][2]["action"] == "block_ip"

    @pytest.mark.asyncio
    async def test_execute_unknown_action_skipped(self):
        """Unknown action types should be skipped."""
        plan = MagicMock()
        plan.id = 3
        plan.status = "approved"
        plan.actions = [
            {"action_type": "nonexistent_action", "target": "x", "priority": 1}
        ]

        db = AsyncMock()
        result = await execute_response_plan(db=db, plan=plan)

        assert result["results"][0]["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_execute_all_action_types(self):
        """All 12 action types should execute successfully."""
        action_types = [
            "notify", "ticket", "block_ip", "block_domain",
            "disable_user", "revoke_token", "isolate_host",
            "quarantine_vlan", "rotate_secret", "snapshot_logs",
            "preserve_pcap", "disable_egress",
        ]
        plan = MagicMock()
        plan.id = 4
        plan.status = "approved"
        plan.actions = [
            {"action_type": at, "target": f"target-{i}", "reason": "test", "priority": i}
            for i, at in enumerate(action_types, 1)
        ]

        db = AsyncMock()
        result = await execute_response_plan(db=db, plan=plan)

        assert result["succeeded"] == 12
        assert result["failed"] == 0
        assert result["total_actions"] == 12

    @pytest.mark.asyncio
    async def test_plan_completes_successfully(self):
        """Plan with valid actions should complete."""
        plan = MagicMock()
        plan.id = 5
        plan.status = "approved"
        plan.actions = [
            {"action_type": "notify", "target": "team", "reason": "test", "priority": 1}
        ]

        db = AsyncMock()
        result = await execute_response_plan(db=db, plan=plan)

        assert result["status"] in ("completed", "partial")
        assert result["succeeded"] == 1


class TestPolicyEngineExtended:
    """Extended policy engine tests for response workflow."""

    def test_all_autonomy_levels_listed(self):
        levels = list_autonomy_levels()
        assert len(levels) == 5
        level_ids = [l["level"] for l in levels]
        assert "L0" in level_ids
        assert "L4" in level_ids

    def test_l0_blocks_everything(self):
        result = check_action_approval("notify", "L0")
        assert result["requires_human"] is True

    def test_l1_allows_notify_ticket(self):
        assert check_action_approval("notify", "L1")["approved"] is True
        assert check_action_approval("ticket", "L1")["approved"] is True
        assert check_action_approval("block_ip", "L1")["approved"] is False

    def test_l3_allows_containment(self):
        assert check_action_approval("block_ip", "L3")["approved"] is True
        assert check_action_approval("snapshot_logs", "L3")["approved"] is True
        assert check_action_approval("isolate_host", "L3")["requires_human"] is True

    def test_l4_crisis_mode(self):
        assert check_action_approval("disable_user", "L4")["approved"] is True
        assert check_action_approval("disable_egress", "L4")["approved"] is True
        # Even L4 requires approval for these
        assert check_action_approval("isolate_host", "L4")["requires_human"] is True

    def test_ot_zone_always_requires_approval(self):
        result = check_action_approval(
            "block_ip", "L4", asset_zone="control", asset_is_ot=True
        )
        assert result["requires_human"] is True
        assert "OT asset" in result["reason"]

    def test_ot_non_containment_passes(self):
        result = check_action_approval(
            "notify", "L3", asset_zone="control", asset_is_ot=True
        )
        assert result["approved"] is True

    def test_always_require_approval_actions(self):
        for action in ["isolate_host", "quarantine_vlan", "rotate_secret"]:
            result = check_action_approval(action, "L4")
            assert result["requires_human"] is True, f"{action} should always require approval"
