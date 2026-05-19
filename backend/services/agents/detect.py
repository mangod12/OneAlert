"""Detect Agent — analyzes security events for anomalies and suspicious patterns."""

import logging
import time
from datetime import datetime, timezone, timedelta
from collections import Counter

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.models.security_event import SecurityEvent
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import get_ai_provider, TASK_DETECT

logger = logging.getLogger(__name__)

DETECT_SYSTEM_PROMPT = """You are an expert network security analyst specializing in OT/ICS environments.

Given aggregated network event statistics, identify potential security threats.

For each finding, provide:
- A short title
- Severity (critical/high/medium/low)
- Description of what was detected and why it's suspicious
- Affected IPs
- Recommended next steps

Respond in JSON:
{
  "findings": [
    {
      "title": "...",
      "severity": "high",
      "description": "...",
      "affected_ips": ["10.0.0.5"],
      "indicators": ["port_scan", "lateral_movement"],
      "recommended_actions": ["Investigate source IP", "Check for compromised credentials"]
    }
  ]
}"""


class DetectAgent(BaseAgent):
    """Analyzes security events for anomalies, port scans, lateral movement, C2 patterns."""

    agent_type = "detect"

    async def run(self, **kwargs) -> dict:
        hours_back = kwargs.get("hours_back", 24)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)

        # Step 1: Aggregate event statistics
        start = time.time()
        stats = await self._aggregate_events(cutoff)
        await self.log_step(
            "aggregate_events",
            f"Analyzed {stats['total_events']} events",
            duration_ms=int((time.time() - start) * 1000),
        )

        if stats["total_events"] == 0:
            await self.log_step("skip", "No events to analyze")
            return {"findings": [], "summary": "No events to analyze"}

        # Step 2: Rule-based detection
        start = time.time()
        rule_findings = self._rule_based_detection(stats)
        await self.log_step(
            "rule_detection",
            f"Found {len(rule_findings)} rule-based findings",
            duration_ms=int((time.time() - start) * 1000),
        )

        # Step 3: LLM-enhanced analysis (if events warrant it)
        llm_findings = []
        if stats["total_events"] > 5 and stats.get("alert_events", 0) > 0:
            start = time.time()
            try:
                llm_findings = await self._llm_analysis(stats)
                await self.log_step(
                    "llm_analysis",
                    f"LLM found {len(llm_findings)} additional findings",
                    tool_used="ai_provider",
                    duration_ms=int((time.time() - start) * 1000),
                )
            except Exception as e:
                logger.warning(f"LLM detection failed, using rules only: {e}")
                await self.log_step("llm_fallback", f"LLM unavailable: {e}")

        # Merge and deduplicate
        all_findings = rule_findings + llm_findings
        return {
            "findings": all_findings,
            "total_events_analyzed": stats["total_events"],
            "summary": f"Analyzed {stats['total_events']} events, found {len(all_findings)} findings",
        }

    async def _aggregate_events(self, cutoff: datetime) -> dict:
        """Build statistical summary of recent events."""
        base = select(SecurityEvent).where(
            SecurityEvent.user_id == self.user_id,
            SecurityEvent.timestamp >= cutoff,
        )

        total = (await self.db.execute(
            select(func.count(SecurityEvent.id)).where(
                SecurityEvent.user_id == self.user_id, SecurityEvent.timestamp >= cutoff)
        )).scalar_one()

        # Alert events
        alert_count = (await self.db.execute(
            select(func.count(SecurityEvent.id)).where(
                SecurityEvent.user_id == self.user_id,
                SecurityEvent.timestamp >= cutoff,
                SecurityEvent.event_type == "alert",
            )
        )).scalar_one()

        # Top source IPs by event count
        src_ip_result = await self.db.execute(
            select(SecurityEvent.source_ip, func.count(SecurityEvent.id).label("cnt"))
            .where(SecurityEvent.user_id == self.user_id, SecurityEvent.timestamp >= cutoff,
                   SecurityEvent.source_ip != None)
            .group_by(SecurityEvent.source_ip)
            .order_by(func.count(SecurityEvent.id).desc())
            .limit(20)
        )
        top_src_ips = {row[0]: row[1] for row in src_ip_result.all()}

        # Top dest ports
        dst_port_result = await self.db.execute(
            select(SecurityEvent.dest_port, func.count(SecurityEvent.id).label("cnt"))
            .where(SecurityEvent.user_id == self.user_id, SecurityEvent.timestamp >= cutoff,
                   SecurityEvent.dest_port != None)
            .group_by(SecurityEvent.dest_port)
            .order_by(func.count(SecurityEvent.id).desc())
            .limit(20)
        )
        top_dst_ports = {row[0]: row[1] for row in dst_port_result.all()}

        # Severity distribution
        sev_result = await self.db.execute(
            select(SecurityEvent.severity, func.count(SecurityEvent.id))
            .where(SecurityEvent.user_id == self.user_id, SecurityEvent.timestamp >= cutoff)
            .group_by(SecurityEvent.severity)
        )
        severity_dist = {row[0]: row[1] for row in sev_result.all()}

        # Top signatures
        sig_result = await self.db.execute(
            select(SecurityEvent.signature, func.count(SecurityEvent.id))
            .where(SecurityEvent.user_id == self.user_id, SecurityEvent.timestamp >= cutoff,
                   SecurityEvent.signature != None)
            .group_by(SecurityEvent.signature)
            .order_by(func.count(SecurityEvent.id).desc())
            .limit(10)
        )
        top_signatures = {row[0]: row[1] for row in sig_result.all()}

        return {
            "total_events": total,
            "alert_events": alert_count,
            "top_source_ips": top_src_ips,
            "top_dest_ports": top_dst_ports,
            "severity_distribution": severity_dist,
            "top_signatures": top_signatures,
        }

    def _rule_based_detection(self, stats: dict) -> list:
        """Simple rule-based anomaly detection."""
        findings = []

        # Rule: Port scan detection (>15 unique dest ports from same source)
        for ip, count in stats["top_source_ips"].items():
            if count > 50:
                findings.append({
                    "title": f"High-volume activity from {ip}",
                    "severity": "medium",
                    "description": f"Source IP {ip} generated {count} events — possible scanning or automated tool.",
                    "affected_ips": [ip],
                    "indicators": ["high_volume"],
                    "recommended_actions": ["Investigate source IP activity", "Check if IP is known scanner"],
                })

        # Rule: OT port access (502=Modbus, 102=S7comm, 44818=EtherNet/IP, 20000=DNP3)
        ot_ports = {502: "Modbus", 102: "S7comm", 44818: "EtherNet/IP", 20000: "DNP3", 4840: "OPC-UA"}
        for port, count in stats["top_dest_ports"].items():
            if port in ot_ports and count > 0:
                findings.append({
                    "title": f"OT protocol traffic detected on port {port} ({ot_ports[port]})",
                    "severity": "high" if count > 10 else "medium",
                    "description": f"{count} events targeting {ot_ports[port]} (port {port}). Verify these are authorized OT communications.",
                    "affected_ips": [],
                    "indicators": ["ot_protocol", ot_ports[port].lower()],
                    "recommended_actions": [f"Verify {ot_ports[port]} traffic is from authorized engineering workstations"],
                })

        # Rule: High critical/high severity count
        critical = stats["severity_distribution"].get("critical", 0)
        high = stats["severity_distribution"].get("high", 0)
        if critical + high > 5:
            findings.append({
                "title": f"Elevated threat level: {critical} critical + {high} high severity events",
                "severity": "high",
                "description": f"Unusual concentration of high-severity events detected.",
                "affected_ips": list(stats["top_source_ips"].keys())[:5],
                "indicators": ["elevated_severity"],
                "recommended_actions": ["Review critical/high events immediately", "Consider running full triage"],
            })

        return findings

    async def _llm_analysis(self, stats: dict) -> list:
        """Use LLM to analyze event statistics for patterns humans might miss."""
        context = f"""Event Statistics (last 24 hours):
Total events: {stats['total_events']}
Alert events: {stats['alert_events']}

Severity distribution: {stats['severity_distribution']}

Top source IPs (IP → event count):
{chr(10).join(f'  {ip}: {count}' for ip, count in list(stats['top_source_ips'].items())[:10])}

Top destination ports (port → count):
{chr(10).join(f'  {port}: {count}' for port, count in list(stats['top_dest_ports'].items())[:10])}

Top signatures:
{chr(10).join(f'  {sig}: {count}' for sig, count in list(stats['top_signatures'].items())[:10])}"""

        provider = get_ai_provider(TASK_DETECT)
        response = await provider.complete_json([
            AIMessage(role="system", content=DETECT_SYSTEM_PROMPT),
            AIMessage(role="user", content=context),
        ])

        return response.get("findings", [])
