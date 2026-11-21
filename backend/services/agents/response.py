"""Response Agent — generates response plans with policy-governed actions."""

import logging
import time

from sqlalchemy import and_, select

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.services.action_executor import ACTION_HANDLERS
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import TASK_TRIAGE, get_ai_provider
from backend.services.policy_engine import check_action_approval_for_context

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
        draft_only = kwargs.get("draft_only", False)

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
            select(Alert, Asset).select_from(CaseAlert)
            .outerjoin(Alert, and_(CaseAlert.alert_id == Alert.id, Alert.user_id == self.user_id))
            .outerjoin(Asset, and_(Alert.asset_id == Asset.id, Asset.user_id == self.user_id))
            .where(CaseAlert.case_id == case_id).order_by(CaseAlert.id.asc())
        )
        alert_assets = alert_rows.all()

        # Step 1: Generate plan via LLM (or fallback)
        start = time.time()
        context = self._build_context(case, alert_assets)
        await self.log_step('planning_scope', output_summary=(
            'Planned AI context: case title (500 chars), summary/tactics (2000 chars each); '
            f'first {min(20, len(alert_assets))} '
            f'of {len(alert_assets)} linked alert/asset records in saved link-ID order; '
            'text fields shortened at 500 chars. Events, raw payloads, notes, tasks and chronology not supplied. '
            'Policy checks still assess all linked asset contexts. These are inputs, not confirmed facts.'
        ))
        try:
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

        actions = response.get("actions") if isinstance(response, dict) else None
        if not isinstance(actions, list) or not 1 <= len(actions) <= 100:
            raise ValueError("Generated response plan requires 1 to 100 saved action records")
        for position, action in enumerate(actions, start=1):
            if not isinstance(action, dict):
                raise ValueError(f"Generated response action {position} must be a record")
            if not isinstance(action.get("action_type"), str) or action["action_type"] not in ACTION_HANDLERS:
                raise ValueError(f"Generated response action {position} has an unsupported action type")
            if not isinstance(action.get("target"), str) or not action["target"].strip():
                raise ValueError(f"Generated response action {position} requires a nonempty target")
            if not isinstance(action.get("reason"), str) or not action["reason"].strip():
                raise ValueError(f"Generated response action {position} requires a nonempty reason")
            if "priority" in action and (type(action["priority"]) is not int or action["priority"] < 0):
                raise ValueError(f"Generated response action {position} requires a nonnegative integer priority")
            if "execution_result" in action:
                raise ValueError(f"Generated response action {position} cannot include preexisting execution results")

        rationale = response.get('rationale', '')
        if not isinstance(rationale, str):
            raise ValueError('Generated response rationale must be text')

        # Step 2: Policy check each action
        checked_actions = []
        needs_approval = False

        for action in actions:
            policy = check_action_approval_for_context(
                action_type=action["action_type"], autonomy_level=autonomy_level,
                asset_contexts=[(asset.network_zone, asset.is_ot_asset) if asset is not None else (None, None)
                                for _, asset in alert_assets],
            )
            action["policy_check"] = policy
            if policy["requires_human"]:
                needs_approval = True
            checked_actions.append(action)

        # Step 3: Create response plan
        plan_status = "draft" if draft_only else "pending_approval" if needs_approval else "approved"
        plan = ResponsePlan(
            case_id=case_id,
            user_id=self.user_id,
            actions=checked_actions,
            status=plan_status,
            autonomy_level=autonomy_level,
            created_by="agent",
        )
        async def save_plan():
            self.db.add(plan)
            await self.db.flush()
            # Draft creation grants no approval and opens no approval request.
            # The existing exact-plan review is required before approval.
            if needs_approval and not draft_only:
                self.db.add(ApprovalRequest(
                    plan_id=plan.id, requested_by="response_agent",
                    reason=response.get("rationale", "Actions require human review"),
                ))
            if not draft_only:
                await self.db.commit()
            await self.log_step("create_plan",
                                output_summary=f"Plan {plan.id}: {len(actions)} actions, status={plan_status}")

        if draft_only:
            # Keep the draft and its creation step atomic. BaseAgent commits the
            # successful run, or a failure ledger after this savepoint rolls back.
            async with self.db.begin_nested():
                await save_plan()
        else:
            await save_plan()

        return {
            "plan_id": plan.id,
            "status": plan_status,
            "actions": checked_actions,
            "rationale": response.get("rationale", ""),
            "needs_approval": needs_approval or draft_only,
            "summary": (
                f"Generated response plan with {len(actions)} actions "
                f"(approval: {'required' if needs_approval or draft_only else 'auto'})"
            ),
        }

    def _build_context(self, case, alert_assets) -> str:
        parts = [
            f"Case: {str(case.title)[:500]}",
            f"Severity: {case.severity}",
            f"Summary: {str(case.summary or 'N/A')[:2000]}",
            f"MITRE Tactics: {str(case.mitre_tactics or [])[:2000]}",
            "",
            f"Selected alert/asset context: first {min(20, len(alert_assets))} of {len(alert_assets)} saved links.",
            "Text fields may be shortened. These summary fields are not full records or verified facts.",
            "Linked events, raw payloads, notes, tasks and chronology are not supplied. "
            "Do not claim they were reviewed.",
            "Do not invent target identities or claim a suggested action has already been approved or performed.",
            "Affected Assets:",
        ]
        for alert, asset in alert_assets[:20]:
            if alert is None:
                parts.append("- Linked evidence unavailable; no alert or asset identity inferred.")
                continue
            if asset is None:
                parts.append(f"- [{alert.severity}] {str(alert.title)[:500]} "
                             "(asset context unavailable; OT/zone unknown)")
                continue
            parts.append(
                f"- [{alert.severity}] {str(alert.title)[:500]} on {str(asset.name)[:500]} "
                f"(type={str(asset.asset_type)[:500]}, zone={str(asset.network_zone or 'unknown')[:500]}, "
                f"OT={asset.is_ot_asset}, protocol={str(asset.primary_protocol or 'N/A')[:500]})"
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
                "reason": "High severity case — block potential attacker", "priority": 3,
            })

        return {
            "actions": actions,
            "rationale": "Rule-based response plan (LLM unavailable).",
        }
