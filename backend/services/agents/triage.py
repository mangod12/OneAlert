"""Triage Agent — correlates alerts + events into investigation cases."""

import json
import logging
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import TASK_TRIAGE, get_ai_provider
from backend.services.triage_intake import ALERT_BATCH_LIMIT, EVENT_BATCH_LIMIT, triage_predicates
from backend.services.triage_output import validate_triage_output

logger = logging.getLogger(__name__)

TRIAGE_SYSTEM_PROMPT = """You are an expert cybersecurity triage analyst for an industrial OT/ICS environment.

Given a set of related security alerts and events, you must:
1. Determine if they represent a single incident or are unrelated
2. Assign a severity (info/low/medium/high/critical)
3. Provide a confidence score (0.0 to 1.0)
4. Map to MITRE ATT&CK tactics and techniques
5. Write a concise attack narrative explaining what happened
6. Suggest a case title

Respond in JSON:
{
  "is_incident": true/false,
  "title": "Case title",
  "summary": "2-3 sentence summary",
  "severity": "critical|high|medium|low|info",
  "confidence": 0.85,
  "attack_narrative": "Detailed narrative of what happened",
  "mitre_tactics": ["TA0001"],
  "mitre_techniques": [{"id": "T1078", "name": "Valid Accounts", "confidence": 0.8}],
  "recommended_actions": ["Action 1", "Action 2"]
}"""


class TriageAgent(BaseAgent):
    """Correlates alerts and events into investigation cases."""

    agent_type = "triage"

    async def run(self, **kwargs) -> dict:
        """Run triage on unprocessed alerts and events.

        Returns: {"cases_created": N, "alerts_triaged": N, "events_triaged": N}
        """
        hours_back = kwargs.get("hours_back", 24)
        cutoff = datetime.now(UTC) - timedelta(hours=hours_back)

        # Step 1: Gather unprocessed alerts
        start = time.time()
        alerts = await self._get_untriaged_alerts(cutoff)
        events = await self._get_untriaged_events(cutoff)
        await self.log_step(
            "gather_data",
            f"Found {len(alerts)} alerts, {len(events)} events",
            duration_ms=int((time.time() - start) * 1000),
        )

        if not alerts and not events:
            await self.log_step("skip", "No untriaged data found")
            return {"status": "completed", "groups_total": 0, "groups_failed": 0, "groups_nonincident": 0,
                    "cases_created": 0, "alerts_triaged": 0, "events_triaged": 0, "summary": "No data to triage"}

        # Step 2: Group by entity overlap (IP, asset, time window)
        start = time.time()
        groups = self._group_by_correlation(alerts, events)
        await self.log_step(
            "correlate",
            f"Grouped into {len(groups)} correlation clusters",
            duration_ms=int((time.time() - start) * 1000),
        )

        # Step 3: For each group, call LLM for analysis
        cases_created = 0
        total_alerts = 0
        total_events = 0
        groups_failed = 0
        groups_nonincident = 0

        for group in groups:
            try:
                # One failed group must not leave a staged case, consumed event
                # or poisoned transaction behind for the remaining groups.
                async with self.db.begin_nested():
                    case = await self._analyze_and_create_case(group)
                if case:
                    cases_created += 1
                    total_alerts += len(group["alerts"])
                    total_events += len(group["events"])
                else:
                    groups_nonincident += 1
            except Exception as e:
                groups_failed += 1
                logger.error(f"Triage group analysis failed: {e}")
                await self.log_step(
                    "group_failed", output_summary=(
                        "Correlation group failed; its case, evidence links and processed-state "
                        "writes were rolled back."
                    ),
                )

        status = "completed" if groups_failed == 0 else "failed" if groups_failed == len(groups) else "partial"
        summary = f"Created {cases_created} cases from {total_alerts} alerts and {total_events} events"
        if groups_failed:
            summary += f"; {groups_failed} of {len(groups)} correlation groups failed and need review or retry"
        return {
            "status": status,
            "groups_total": len(groups),
            "groups_failed": groups_failed,
            "groups_nonincident": groups_nonincident,
            "cases_created": cases_created,
            "alerts_triaged": total_alerts,
            "events_triaged": total_events,
            "summary": summary,
        }

    async def _get_untriaged_alerts(self, cutoff: datetime) -> list:
        result = await self.db.execute(
            select(Alert)
            .where(*triage_predicates(self.user_id, cutoff, 'alert'))
            .order_by(Alert.created_at.desc(), Alert.id.desc())
            .limit(ALERT_BATCH_LIMIT)
        )
        return result.scalars().all()

    async def _get_untriaged_events(self, cutoff: datetime) -> list:
        result = await self.db.execute(
            select(SecurityEvent)
            .where(*triage_predicates(self.user_id, cutoff, 'event'))
            .order_by(SecurityEvent.timestamp.desc(), SecurityEvent.id.desc())
            .limit(EVENT_BATCH_LIMIT)
        )
        return result.scalars().all()

    def _group_by_correlation(self, alerts: list, events: list) -> list:
        """Group alerts by asset and events by transitive shared saved IPs.

        A candidate cluster is not proof of a common incident. Alert asset IDs
        and event IP strings use separate namespaces; no asset-to-IP mapping is
        inferred. Intake already bounds both evidence sets to this owner/window.
        """
        asset_groups = {}
        for alert in alerts:
            group = asset_groups.setdefault(alert.asset_id, {"alerts": [], "events": [], "ips": set()})
            group["alerts"].append(alert)

        # Connected components include late bridge records, independent of input
        # order. Keep the original intake order within each resulting component.
        parents = list(range(len(events)))

        def root(index):
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index

        ip_first = {}
        for index, event in enumerate(events):
            for ip in (event.source_ip, event.dest_ip):
                if not ip:
                    continue
                if ip in ip_first:
                    left, right = root(index), root(ip_first[ip])
                    parents[max(left, right)] = min(left, right)
                else:
                    ip_first[ip] = index

        event_groups = {}
        for index, event in enumerate(events):
            group = event_groups.setdefault(root(index), {"alerts": [], "events": [], "ips": set()})
            group["events"].append(event)
            group["ips"].update(ip for ip in (event.source_ip, event.dest_ip) if ip)

        # Retain informational evidence when connected to a non-info event, but
        # do not turn standalone informational telemetry into an incident candidate.
        return [*asset_groups.values(), *[
            group for group in event_groups.values()
            if any(event.severity != "info" for event in group["events"])
        ]]

    async def _analyze_and_create_case(self, group: dict) -> Case | None:
        """Use LLM to analyze a correlation group and create a case."""
        alerts = group["alerts"]
        events = group["events"]

        # Build context for LLM
        context = self._build_llm_context(alerts, events)

        start = time.time()
        try:
            provider = get_ai_provider(TASK_TRIAGE)
            response = await provider.complete_json([
                AIMessage(role="system", content=TRIAGE_SYSTEM_PROMPT),
                AIMessage(role="user", content=context),
            ])
            self._last_model = provider.model
            duration = int((time.time() - start) * 1000)

            await self.log_step(
                "llm_analysis",
                f"Analyzed {len(alerts)} alerts + {len(events)} events",
                output_summary=json.dumps(response)[:500],
                tool_used="ai_provider",
                duration_ms=duration,
            )

        except Exception as e:
            # Fallback: create case without LLM
            logger.warning(f"LLM analysis failed, using rule-based fallback: {e}")
            response = self._rule_based_fallback(alerts, events)
            await self.log_step(
                "rule_based_fallback",
                "LLM unavailable, used rule-based analysis",
                duration_ms=int((time.time() - start) * 1000),
            )

        # Reject malformed evidence before staging a case, link or processed-state change.
        response = validate_triage_output(response)
        if not response["is_incident"]:
            await self.log_step("skip_group", "LLM determined events are not an incident")
            return None

        # Create case
        case = Case(
            user_id=self.user_id,
            title=response.get("title", "Untitled Investigation"),
            summary=response.get("summary"),
            severity=response.get("severity", "medium"),
            status="open",
            confidence_score=response.get("confidence", 0.5),
            mitre_tactics=response.get("mitre_tactics"),
            mitre_techniques=response.get("mitre_techniques"),
            attack_narrative=response.get("attack_narrative"),
            created_by="agent",
        )
        self.db.add(case)
        await self.db.flush()

        # Link alerts
        for alert in alerts:
            self.db.add(CaseAlert(case_id=case.id, alert_id=alert.id))

        # Link events + mark processed
        for event in events:
            self.db.add(CaseEvent(case_id=case.id, event_id=event.id))
            event.processed = "in_case"

        # Add timeline entries
        self.db.add(CaseTimeline(
            case_id=case.id,
            entry_type="ai_analysis",
            content=response.get("attack_narrative") or response.get("summary") or "No narrative was recorded.",
            source="agent",
            metadata_json={"confidence": response.get("confidence"), "model": getattr(self, '_last_model', 'unknown')},
        ))

        if response.get("recommended_actions"):
            for action in response["recommended_actions"]:
                self.db.add(CaseTimeline(
                    case_id=case.id,
                    entry_type="action",
                    content=f"Recommended: {action}",
                    source="agent",
                ))

        await self.db.flush()

        await self.log_step(
            "create_case",
            output_summary=(
                f"Created case '{case.title}' "
                f"(severity={case.severity}, confidence={case.confidence_score})"
            ),
        )

        return case

    def _build_llm_context(self, alerts: list, events: list) -> str:
        """Build a concise context string for LLM analysis."""
        parts = []

        if alerts:
            parts.append("=== ALERTS ===")
            parts.extend(
                f"- [{a.severity}] {a.title} | CVE: {a.cve_id or 'N/A'} | "
                f"Asset ID: {a.asset_id} | CVSS: {a.cvss_score or 'N/A'}"
                for a in alerts[:20]
            )

        if events:
            parts.append("\n=== SECURITY EVENTS ===")
            parts.extend(
                f"- [{e.severity}] {e.event_type} | {e.source_ip}:{e.source_port or ''} → "
                f"{e.dest_ip}:{e.dest_port or ''} | "
                f"sig: {e.signature or 'N/A'} | cat: {e.category or 'N/A'}"
                for e in events[:50]
            )

        return "\n".join(parts)

    def _rule_based_fallback(self, alerts: list, events: list) -> dict:
        """Simple rule-based triage when LLM is unavailable."""
        severities = [a.severity for a in alerts] + [e.severity for e in events]
        max_sev = "info"
        for s in ["critical", "high", "medium", "low"]:
            if s in severities:
                max_sev = s
                break

        title_parts = []
        if alerts:
            title_parts.append(alerts[0].title)
        elif events:
            sig = next((e.signature for e in events if e.signature), None)
            title_parts.append(sig or f"{events[0].event_type} activity")

        return {
            "is_incident": True,
            "title": " + ".join(title_parts)[:200],
            "summary": f"Correlated {len(alerts)} alerts and {len(events)} events. Manual review recommended.",
            "severity": max_sev,
            "confidence": 0.4,
            "attack_narrative": f"Automated correlation found {len(alerts)} alerts and {len(events)} related events.",
            "mitre_tactics": [],
            "mitre_techniques": [],
            "recommended_actions": ["Review correlated events", "Assess affected assets"],
        }
