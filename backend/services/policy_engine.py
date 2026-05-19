"""Policy engine — autonomy levels, zone restrictions, and action approval rules."""

import logging

logger = logging.getLogger(__name__)

# Autonomy levels
AUTONOMY_LEVELS = {
    "L0": {"name": "Read-only", "auto_approve": [], "description": "Summarizes and explains only"},
    "L1": {"name": "Assisted", "auto_approve": ["notify", "ticket"], "description": "Drafts plans, can notify"},
    "L2": {"name": "Approved actions", "auto_approve": ["notify", "ticket"], "description": "Executes after human approval"},
    "L3": {"name": "Guarded autonomy", "auto_approve": ["notify", "ticket", "block_ip", "block_domain", "snapshot_logs"], "description": "Auto-executes low-risk containment"},
    "L4": {"name": "Crisis mode", "auto_approve": ["notify", "ticket", "block_ip", "block_domain", "disable_user", "revoke_token", "snapshot_logs", "preserve_pcap", "disable_egress"], "description": "Aggressive defense in owned environment"},
}

# Actions that ALWAYS require human approval regardless of autonomy level
ALWAYS_REQUIRE_APPROVAL = {"isolate_host", "quarantine_vlan", "rotate_secret"}

# OT zone restrictions — Purdue Level 0-3 always requires human approval
OT_RESTRICTED_ZONES = {"control", "field", "safety_system"}


def check_action_approval(
    action_type: str,
    autonomy_level: str = "L1",
    asset_zone: str | None = None,
    asset_is_ot: bool = False,
) -> dict:
    """Check if an action can be auto-approved or needs human approval.

    Returns: {"approved": bool, "reason": str, "requires_human": bool}
    """
    level_config = AUTONOMY_LEVELS.get(autonomy_level, AUTONOMY_LEVELS["L1"])

    # Hard constraint: OT zones always require approval for containment actions
    containment_actions = {"isolate_host", "quarantine_vlan", "disable_egress", "block_ip", "disable_user"}
    if asset_is_ot and asset_zone in OT_RESTRICTED_ZONES and action_type in containment_actions:
        return {
            "approved": False,
            "reason": f"OT asset in {asset_zone} zone — containment actions always require human approval",
            "requires_human": True,
        }

    # Actions that always require approval
    if action_type in ALWAYS_REQUIRE_APPROVAL:
        return {
            "approved": False,
            "reason": f"Action '{action_type}' always requires human approval",
            "requires_human": True,
        }

    # Check autonomy level auto-approve list
    if action_type in level_config["auto_approve"]:
        return {
            "approved": True,
            "reason": f"Auto-approved at {autonomy_level} ({level_config['name']})",
            "requires_human": False,
        }

    # Default: requires approval
    return {
        "approved": False,
        "reason": f"Action '{action_type}' not in auto-approve list for {autonomy_level}",
        "requires_human": True,
    }


def get_autonomy_level_info(level: str) -> dict | None:
    """Get information about an autonomy level."""
    info = AUTONOMY_LEVELS.get(level)
    if info:
        return {"level": level, **info}
    return None


def list_autonomy_levels() -> list:
    """List all autonomy levels."""
    return [{"level": k, **v} for k, v in AUTONOMY_LEVELS.items()]
