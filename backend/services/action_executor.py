"""Action executor — executes approved response plan actions with structured logging."""

import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.response_plan import ResponsePlan

logger = logging.getLogger(__name__)

# Action handlers registry — each returns (success, detail_message)
ACTION_HANDLERS = {
    "notify": "_execute_notify",
    "ticket": "_execute_ticket",
    "block_ip": "_execute_block_ip",
    "block_domain": "_execute_block_domain",
    "disable_user": "_execute_disable_user",
    "revoke_token": "_execute_revoke_token",
    "isolate_host": "_execute_isolate_host",
    "quarantine_vlan": "_execute_quarantine_vlan",
    "rotate_secret": "_execute_rotate_secret",
    "snapshot_logs": "_execute_snapshot_logs",
    "preserve_pcap": "_execute_preserve_pcap",
    "disable_egress": "_execute_disable_egress",
}


async def execute_response_plan(db: AsyncSession, plan: ResponsePlan) -> dict:
    """Execute all actions in an approved response plan.

    Actions execute in priority order. Each action result is logged.
    Plan status transitions: approved -> executing -> completed/failed.
    """
    plan.status = "executing"
    await db.flush()

    actions = plan.actions or []
    sorted_actions = sorted(actions, key=lambda a: a.get("priority", 99))

    results = []
    failed = 0
    succeeded = 0

    for action in sorted_actions:
        action_type = action.get("action_type", "unknown")
        target = action.get("target", "unknown")

        handler_name = ACTION_HANDLERS.get(action_type)
        if not handler_name:
            result = {"action": action_type, "target": target, "status": "skipped",
                       "detail": f"Unknown action type: {action_type}"}
            results.append(result)
            continue

        handler = globals()[handler_name]
        try:
            success, detail = await handler(action)
            status = "completed" if success else "failed"
            if success:
                succeeded += 1
            else:
                failed += 1

            result = {"action": action_type, "target": target, "status": status, "detail": detail}
            logger.info(f"Action {action_type} on {target}: {status} — {detail}")
        except Exception as e:
            failed += 1
            result = {"action": action_type, "target": target, "status": "error", "detail": "Action failed"}
            logger.error("Action %s on %s failed: %s", action_type, target, type(e).__name__)

        result["executed_at"] = datetime.now(timezone.utc).isoformat()
        results.append(result)

    # Update plan status
    plan.status = "completed" if failed == 0 else "partial"
    # Store execution results back into actions
    updated_actions = []
    for action, result in zip(sorted_actions, results):
        action["execution_result"] = result
        updated_actions.append(action)
    plan.actions = updated_actions

    await db.commit()

    return {
        "plan_id": plan.id,
        "status": plan.status,
        "total_actions": len(sorted_actions),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }


# --- Action Handlers (simulated — real integrations plug in here) ---

async def _execute_notify(action: dict) -> tuple[bool, str]:
    """Send notification to incident responders."""
    target = action.get("target", "default-channel")
    reason = action.get("reason", "")
    logger.info(f"NOTIFY: {target} — {reason}")
    return True, f"Notification sent to {target}"


async def _execute_ticket(action: dict) -> tuple[bool, str]:
    """Create incident ticket."""
    target = action.get("target", "incident-queue")
    reason = action.get("reason", "")
    logger.info(f"TICKET: Created for {target} — {reason}")
    return True, f"Ticket created in {target}"


async def _execute_block_ip(action: dict) -> tuple[bool, str]:
    """Block a suspicious IP address (simulated firewall rule)."""
    target = action.get("target", "unknown")
    logger.info(f"BLOCK_IP: Firewall rule queued for {target}")
    return True, f"Firewall block rule queued for IP {target}"


async def _execute_block_domain(action: dict) -> tuple[bool, str]:
    """Block a malicious domain (simulated DNS sinkhole)."""
    target = action.get("target", "unknown")
    logger.info(f"BLOCK_DOMAIN: DNS sinkhole rule for {target}")
    return True, f"DNS sinkhole rule created for {target}"


async def _execute_disable_user(action: dict) -> tuple[bool, str]:
    """Disable a compromised user account (simulated)."""
    target = action.get("target", "unknown")
    logger.info(f"DISABLE_USER: Account {target} disabled")
    return True, f"User account {target} disabled"


async def _execute_revoke_token(action: dict) -> tuple[bool, str]:
    """Revoke active sessions/tokens (simulated)."""
    target = action.get("target", "unknown")
    logger.info(f"REVOKE_TOKEN: Sessions revoked for {target}")
    return True, f"Active sessions revoked for {target}"


async def _execute_isolate_host(action: dict) -> tuple[bool, str]:
    """Isolate a compromised host (simulated EDR action)."""
    target = action.get("target", "unknown")
    logger.info(f"ISOLATE_HOST: Network isolation for {target}")
    return True, f"Host {target} isolated from network"


async def _execute_quarantine_vlan(action: dict) -> tuple[bool, str]:
    """Quarantine an entire VLAN/segment (simulated switch config)."""
    target = action.get("target", "unknown")
    logger.info(f"QUARANTINE_VLAN: VLAN {target} quarantined")
    return True, f"VLAN {target} moved to quarantine segment"


async def _execute_rotate_secret(action: dict) -> tuple[bool, str]:
    """Rotate credentials/API keys (simulated)."""
    target = action.get("target", "unknown")
    logger.info(f"ROTATE_SECRET: Credentials rotated for {target}")
    return True, f"Credentials rotated for {target}"


async def _execute_snapshot_logs(action: dict) -> tuple[bool, str]:
    """Preserve current log state (simulated log archival)."""
    target = action.get("target", "affected-assets")
    logger.info(f"SNAPSHOT_LOGS: Log snapshot taken for {target}")
    return True, f"Log snapshot archived for {target}"


async def _execute_preserve_pcap(action: dict) -> tuple[bool, str]:
    """Capture and preserve network traffic (simulated)."""
    target = action.get("target", "unknown")
    logger.info(f"PRESERVE_PCAP: Packet capture started for {target}")
    return True, f"PCAP capture initiated for {target}"


async def _execute_disable_egress(action: dict) -> tuple[bool, str]:
    """Block outbound traffic from compromised host (simulated)."""
    target = action.get("target", "unknown")
    logger.info(f"DISABLE_EGRESS: Outbound traffic blocked for {target}")
    return True, f"Egress traffic blocked for {target}"
