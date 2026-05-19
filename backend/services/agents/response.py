"""Response Agent — generates response plans with policy-governed actions."""

import logging
import time
import json
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models.case import Case, CaseAlert
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.response_plan import ResponsePlan, ApprovalRequest
from backend.services.agents.base import BaseAgent
from backend.services.policy_engine import check_action_approval
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import get_ai_provider, TASK_TRIAGE

logger = logging.getLogger(__name__)

RESPONSE_SYSTEM_PROMPT = """You are a cybersecurity incident response specialist for an OT/ICS environment.

Given a case with alerts and context, generate a response plan with ordered actions.

Available action types:
- notify: Send notification to incident responders
- ticket: Create incident ticket
- block_ip: Block a suspicious IP address
- block_domain: Block a malicious domain
- disable_user: Disable a compromised user account
- revoke_token: Revoke active sessions/tokens
- isolate_host: Isolate a compromised host from the network
- quarantine_vlan: Quarantine an entire VLAN/segment
- rotate_secret: Rotate credentials/API keys
- snapshot_logs: Preserve current log state
- preserve_pcap: Capture and preserve network traffic
- disable_egress: Block outbound traffic from compromised host

Rules:
- Order actions by urgency (containment first, then investigation, then cleanup)
- For OT assets, prefer network segmentation over direct host actions
- Always include "notify" as the first action
- Always include "snapshot_logs" for evidence preservation

Respond in JSON:
{
  "actions": [
    {"action_type": "notify", "target": "incident-response-team", "reason": "...", "priority": 1},
    {"action_type": "block_ip", "target": "10.0.0.5", "reason": "...", "priority": 2}
  ],
  "rationale": "Explanation of the response strategy"
}"""


class ResponseAgent(BaseAgent):
    """Generates response plans for investigation cases."""

    agent_type = "response"

    async def run(self, **kwargs) -> dict:
        case_id = kwargs.get("case_id")
        autonomy_level = kwargs.get("autonomy_level", "L1")

        if not case_id:
            return {"error": "case_id required"}

        # Get case with context
        case = (await self.db.execute(
            select(Case).where(Case.id == case_id, Case.user_id == self.user_id)
        )).scalar_one_or_none()

        if not case:
            return {"error": "Case not found"}

        # Get linked alerts with assets
        alert_rows = await self.db.execute(
            select(Alert, Asset)
            .join(CaseAlert, CaseAlert.alert_id == Alert.id)
            .join(Asset, Alert.asset_id == Asset.id)
            .where(CaseAlert.case_id == case_id)
        )
        alert_assets = alert_rows.all()

        # Step 1: Generate plan via LLM (or fallback)
        start = time.time()
        try:
            context = self._build_context(case, alert_assets)
            provider = get_ai_provider(TASK_TRIAGE)
            response = await provider.complete_json([
                AIMessage(role="system", content=RESPONSE_SYSTEM_PROMPT),
                AIMessage(role="user", content=context),
            ])
            self._last_model = provider.model
            await self.log_step("generate_plan", f"Case: {case.title}", tool_used="ai_provider",
                                duration_ms=int((time.time() - start) * 1000))
        except Exception as e:
            logger.warning(f"LLM response planning failed: {e}")
            response = self._fallback_plan(case, alert_assets)
            await self.log_step("fallback_plan", f"LLM unavailable: {e}")

        actions = response.get("actions", [])

        # Step 2: Policy check each action
        checked_actions = []
        needs_approval = False

        for action in actions:
            # Find if any affected asset is OT
            is_ot = any(a.is_ot_asset for _, a in alert_assets)
            zone = next((a.network_zone for _, a in alert_assets if a.network_zone), None)

            policy = check_action_approval(
                action_type=action["action_type"],
                autonomy_level=autonomy_level,
                asset_zone=zone,
                asset_is_ot=is_ot,
            )
            action["policy_check"] = policy
            if policy["requires_human"]:
                needs_approval = True
            checked_actions.append(action)

        # Step 3: Create response plan
        plan_status = "pending_approval" if needs_approval else "approved"
        plan = ResponsePlan(
            case_id=case_id,
            user_id=self.user_id,
            actions=checked_actions,
            status=plan_status,
            autonomy_level=autonomy_level,
            created_by="agent",
        )
        self.db.add(plan)
        await self.db.flush()

        # Create approval request if needed
        if needs_approval:
            approval = ApprovalRequest(
                plan_id=plan.id,
                requested_by="response_agent",
                reason=response.get("rationale", "Actions require human review"),
            )
            self.db.add(approval)

        await self.db.commit()

        await self.log_step("create_plan",
                            output_summary=f"Plan {plan.id}: {len(actions)} actions, status={plan_status}")

        return {
            "plan_id": plan.id,
            "status": plan_status,
            "actions": checked_actions,
            "rationale": response.get("rationale", ""),
            "needs_approval": needs_approval,
            "summary": f"Generated response plan with {len(actions)} actions (approval: {'required' if needs_approval else 'auto'})",
        }

    def _build_context(self, case, alert_assets) -> str:
        parts = [
            f"Case: {case.title}",
            f"Severity: {case.severity}",
            f"Summary: {case.summary or 'N/A'}",
            f"MITRE Tactics: {case.mitre_tactics or []}",
            "",
            "Affected Assets:",
        ]
        for alert, asset in alert_assets:
            parts.append(
                f"- [{alert.severity}] {alert.title} on {asset.name} "
                f"(type={asset.asset_type}, zone={asset.network_zone or 'unknown'}, "
                f"OT={asset.is_ot_asset}, protocol={asset.primary_protocol or 'N/A'})"
            )
        return "\n".join(parts)

    def _fallback_plan(self, case, alert_assets) -> dict:
        actions = [
            {"action_type": "notify", "target": "incident-response-team",
             "reason": f"New case: {case.title}", "priority": 1},
            {"action_type": "snapshot_logs", "target": "affected-assets",
             "reason": "Preserve evidence", "priority": 2},
        ]

        if case.severity in ("critical", "high"):
            actions.append({
                "action_type": "block_ip", "target": "suspicious-source",
                "reason": f"High severity case — block potential attacker", "priority": 3,
            })

        return {
            "actions": actions,
            "rationale": "Rule-based response plan (LLM unavailable).",
        }
