"""Triage Agent — correlates alerts + events into investigation cases."""

import logging
import time
import json
from datetime import datetime, timezone, timedelta
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.security_event import SecurityEvent
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import get_ai_provider, TASK_TRIAGE

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
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)

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
            return {"cases_created": 0, "alerts_triaged": 0, "events_triaged": 0, "summary": "No data to triage"}

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

        for group in groups:
            try:
                case = await self._analyze_and_create_case(group)
                if case:
                    cases_created += 1
                    total_alerts += len(group["alerts"])
                    total_events += len(group["events"])
            except Exception as e:
                logger.error(f"Triage group analysis failed: {e}")

        return {
            "cases_created": cases_created,
            "alerts_triaged": total_alerts,
            "events_triaged": total_events,
            "summary": f"Created {cases_created} cases from {total_alerts} alerts and {total_events} events",
        }

    async def _get_untriaged_alerts(self, cutoff: datetime) -> list:
        result = await self.db.execute(
            select(Alert)
            .where(Alert.user_id == self.user_id, Alert.created_at >= cutoff)
            .order_by(Alert.created_at.desc())
            .limit(100)
        )
        return result.scalars().all()

    async def _get_untriaged_events(self, cutoff: datetime) -> list:
        result = await self.db.execute(
            select(SecurityEvent)
            .where(
                SecurityEvent.user_id == self.user_id,
                SecurityEvent.timestamp >= cutoff,
                SecurityEvent.processed == "pending",
            )
            .order_by(SecurityEvent.timestamp.desc())
            .limit(500)
        )
        return result.scalars().all()

    def _group_by_correlation(self, alerts: list, events: list) -> list:
        """Group alerts and events by overlapping IPs, assets, and time windows."""
        groups = []

        # Build IP → items index
        ip_map: dict[str, dict] = {}

        for alert in alerts:
            asset_id = alert.asset_id
            key = f"asset_{asset_id}"
            if key not in ip_map:
                ip_map[key] = {"alerts": [], "events": [], "ips": set()}
            ip_map[key]["alerts"].append(alert)

        for event in events:
            keys = set()
            if event.source_ip:
                keys.add(event.source_ip)
            if event.dest_ip:
                keys.add(event.dest_ip)

            # Try to attach to existing group
            matched = False
            for existing_key, group in ip_map.items():
                if keys & group["ips"]:
                    group["events"].append(event)
                    group["ips"] |= keys
                    matched = True
                    break

            if not matched:
                # New group from event
                new_key = event.source_ip or event.dest_ip or f"event_{event.id}"
                if new_key not in ip_map:
                    ip_map[new_key] = {"alerts": [], "events": [], "ips": keys}
                ip_map[new_key]["events"].append(event)
                ip_map[new_key]["ips"] |= keys

        # Filter out groups with only info-level events and no alerts
        for key, group in ip_map.items():
            if group["alerts"] or any(e.severity != "info" for e in group["events"]):
                groups.append(group)

        return groups

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
                f"LLM unavailable, used rule-based analysis",
                duration_ms=int((time.time() - start) * 1000),
            )

        if not response.get("is_incident", True):
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
            content=response.get("attack_narrative", response.get("summary", "")),
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
            output_summary=f"Created case '{case.title}' (severity={case.severity}, confidence={case.confidence_score})",
        )

        return case

    def _build_llm_context(self, alerts: list, events: list) -> str:
        """Build a concise context string for LLM analysis."""
        parts = []

        if alerts:
            parts.append("=== ALERTS ===")
            for a in alerts[:20]:
                parts.append(f"- [{a.severity}] {a.title} | CVE: {a.cve_id or 'N/A'} | Asset ID: {a.asset_id} | CVSS: {a.cvss_score or 'N/A'}")

        if events:
            parts.append("\n=== SECURITY EVENTS ===")
            for e in events[:50]:
                parts.append(
                    f"- [{e.severity}] {e.event_type} | {e.source_ip}:{e.source_port or ''} → {e.dest_ip}:{e.dest_port or ''} | "
                    f"sig: {e.signature or 'N/A'} | cat: {e.category or 'N/A'}"
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
