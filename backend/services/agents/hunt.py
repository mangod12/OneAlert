"""Hunt Agent — natural-language threat hunting with query generation."""

import logging
import time
import json
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select

from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import get_ai_provider, TASK_HUNT
from backend.models.security_event import SecurityEvent

logger = logging.getLogger(__name__)

DEFAULT_HUNT_COLUMNS = (
    "id", "timestamp", "event_type", "severity", "source_ip", "dest_ip", "signature",
)

ALLOWED_HUNT_COLUMNS = {
    "id": SecurityEvent.id,
    "timestamp": SecurityEvent.timestamp,
    "event_type": SecurityEvent.event_type,
    "severity": SecurityEvent.severity,
    "signature": SecurityEvent.signature,
    "signature_id": SecurityEvent.signature_id,
    "category": SecurityEvent.category,
    "source_ip": SecurityEvent.source_ip,
    "source_port": SecurityEvent.source_port,
    "dest_ip": SecurityEvent.dest_ip,
    "dest_port": SecurityEvent.dest_port,
    "protocol": SecurityEvent.protocol,
    "action": SecurityEvent.action,
    "hostname": SecurityEvent.hostname,
    "username": SecurityEvent.username,
    "domain": SecurityEvent.domain,
    "url": SecurityEvent.url,
    "user_agent": SecurityEvent.user_agent,
    "bytes_in": SecurityEvent.bytes_in,
    "bytes_out": SecurityEvent.bytes_out,
    "source_type": SecurityEvent.source_type,
    "processed": SecurityEvent.processed,
}

TEXT_FILTER_COLUMNS = {
    "signature", "category", "hostname", "username", "domain", "url", "user_agent",
}

EQUALITY_FILTER_COLUMNS = {
    "event_type", "severity", "source_ip", "dest_ip", "protocol", "action",
    "source_type", "processed",
}

HUNT_SYSTEM_PROMPT = """You are a threat hunting specialist for an OT/ICS cybersecurity platform.

The user provides a hunting hypothesis. Generate SQL queries to test it against the security_events table.

Table schema:
  security_events(id, user_id, timestamp, event_type, severity, signature, signature_id,
  category, source_ip, source_port, dest_ip, dest_port, protocol, action, hostname,
  username, domain, url, user_agent, bytes_in, bytes_out, source_type, processed)

Rules:
- ALWAYS include WHERE user_id = :user_id for data isolation
- Use parameterized :user_id, never hardcode
- Only SELECT queries — no INSERT/UPDATE/DELETE
- Return max 3 queries from simple to complex
- Include a Sigma detection rule if findings confirm the hypothesis

Respond in JSON:
{
  "queries": [
    {"description": "What this query looks for", "sql": "SELECT ..."}
  ],
  "sigma_rule": "title: ...\\nstatus: experimental\\n...",
  "explanation": "Why these queries test the hypothesis"
}"""


class HuntAgent(BaseAgent):
    """Natural-language threat hunting with auto-generated queries."""

    agent_type = "hunt"

    async def run(self, **kwargs) -> dict:
        hypothesis = kwargs.get("hypothesis", "")
        if not hypothesis:
            return {"error": "No hunting hypothesis provided"}

        # Step 1: Generate hunting queries via LLM
        start = time.time()
        try:
            provider = get_ai_provider(TASK_HUNT)
            response = await provider.complete_json([
                AIMessage(role="system", content=HUNT_SYSTEM_PROMPT),
                AIMessage(role="user", content=f"Hunting hypothesis: {hypothesis}"),
            ])
            self._last_model = provider.model
            await self.log_step(
                "generate_queries",
                f"Hypothesis: {hypothesis}",
                output_summary=json.dumps(response)[:500],
                tool_used="ai_provider",
                duration_ms=int((time.time() - start) * 1000),
            )
        except Exception as e:
            logger.error(f"LLM query generation failed: {e}")
            # Fallback: basic keyword search
            response = self._fallback_queries(hypothesis)
            await self.log_step("fallback_queries", f"LLM unavailable: {e}")

        # Step 2: Execute queries (read-only)
        queries = response.get("queries", [])
        results = []

        for q in queries[:3]:  # Max 3 queries
            sql = q.get("sql", "")
            if not self._is_safe_query(sql):
                results.append({"query": q, "error": "Query rejected — not a SELECT", "rows": []})
                continue

            start = time.time()
            try:
                query_results = await self._execute_query(sql, q.get("params"))
                results.append({
                    "query": q,
                    "rows": query_results[:100],  # Cap at 100 rows
                    "row_count": len(query_results),
                })
                await self.log_step(
                    "execute_query",
                    q.get("description", ""),
                    output_summary=f"{len(query_results)} rows returned",
                    tool_used="database",
                    duration_ms=int((time.time() - start) * 1000),
                )
            except Exception as e:
                results.append({"query": q, "error": str(e), "rows": []})
                await self.log_step("query_error", str(e))

        return {
            "hypothesis": hypothesis,
            "query_results": results,
            "sigma_rule": response.get("sigma_rule"),
            "explanation": response.get("explanation"),
            "summary": f"Executed {len(results)} queries for hypothesis: {hypothesis}",
        }

    async def _execute_query(self, sql: str, params: dict | None = None) -> list:
        """Execute a read-only SQL query with user_id scoping."""
        query = self._build_safe_query(sql, params or {})
        result = await self.db.execute(query)
        columns = result.keys()
        rows = []
        for row in result.fetchall():
            rows.append(dict(zip(columns, row)))
        return rows

    def _build_safe_query(self, sql: str, params: dict) -> object:
        """Build a constrained SQLAlchemy query from validated hunt SQL."""
        selected = self._selected_columns(sql)
        query = select(*[ALLOWED_HUNT_COLUMNS[name].label(name) for name in selected])
        query = query.where(SecurityEvent.user_id == self.user_id)

        keyword = params.get("keyword")
        if keyword:
            query = query.where(or_(
                SecurityEvent.signature.like(keyword),
                SecurityEvent.category.like(keyword),
            ))

        query = self._apply_literal_filters(query, sql)
        query = self._apply_ordering(query, sql)
        return query.limit(self._limit(sql))

    def _selected_columns(self, sql: str) -> list[str]:
        """Extract simple selected column names, falling back to a safe default."""
        match = re.search(r"\bSELECT\s+(.*?)\s+FROM\s+security_events\b", sql, re.IGNORECASE | re.DOTALL)
        if not match:
            return list(DEFAULT_HUNT_COLUMNS)

        raw_columns = [part.strip() for part in match.group(1).split(",")]
        if raw_columns == ["*"]:
            return list(DEFAULT_HUNT_COLUMNS)

        selected = []
        for raw in raw_columns:
            name = re.sub(r"\s+AS\s+\w+$", "", raw, flags=re.IGNORECASE).strip().lower()
            if name in ALLOWED_HUNT_COLUMNS:
                selected.append(name)
        return selected or list(DEFAULT_HUNT_COLUMNS)

    def _apply_literal_filters(self, query, sql: str):
        """Apply supported literal filters from generated SQL."""
        for name in EQUALITY_FILTER_COLUMNS:
            pattern = rf"\b{name}\s*=\s*'([^']{{1,128}})'"
            match = re.search(pattern, sql, re.IGNORECASE)
            if match:
                query = query.where(ALLOWED_HUNT_COLUMNS[name] == match.group(1))

        severity_in = re.search(r"\bseverity\s+IN\s*\(([^)]{1,256})\)", sql, re.IGNORECASE)
        if severity_in:
            values = re.findall(r"'([^']{1,32})'", severity_in.group(1))
            if values:
                query = query.where(SecurityEvent.severity.in_(values[:10]))

        for name in TEXT_FILTER_COLUMNS:
            pattern = rf"\b{name}\s+LIKE\s+'([^']{{1,128}})'"
            match = re.search(pattern, sql, re.IGNORECASE)
            if match:
                query = query.where(ALLOWED_HUNT_COLUMNS[name].like(match.group(1)))
        return query

    def _apply_ordering(self, query, sql: str):
        """Apply supported ordering, defaulting to newest events first."""
        match = re.search(r"\bORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?", sql, re.IGNORECASE)
        if not match:
            return query.order_by(SecurityEvent.timestamp.desc())

        column_name = match.group(1).lower()
        column = ALLOWED_HUNT_COLUMNS.get(column_name, SecurityEvent.timestamp)
        direction = (match.group(2) or "ASC").upper()
        return query.order_by(column.desc() if direction == "DESC" else column.asc())

    def _limit(self, sql: str) -> int:
        """Read a generated LIMIT, capped to the API row limit."""
        match = re.search(r"\bLIMIT\s+(\d{1,3})\b", sql, re.IGNORECASE)
        if not match:
            return 100
        return max(1, min(int(match.group(1)), 100))

    def _is_safe_query(self, sql: str) -> bool:
        """Validate a generated hunt query is a single scoped read-only SELECT."""
        normalized = " ".join(sql.strip().split())
        upper = normalized.upper()
        if not upper.startswith("SELECT "):
            return False
        if not normalized or ";" in normalized or "--" in normalized or "/*" in normalized or "*/" in normalized:
            return False

        dangerous = (
            "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
            "EXEC", "EXECUTE", "GRANT", "REVOKE", "MERGE", "CALL", "COPY",
            "ATTACH", "DETACH", "PRAGMA", "VACUUM",
        )
        if re.search(rf"\b({'|'.join(dangerous)})\b", upper):
            return False
        if not re.search(r"\bFROM\s+security_events\b", normalized, re.IGNORECASE):
            return False
        if not re.search(r"\buser_id\s*=\s*:user_id\b", normalized, re.IGNORECASE):
            return False
        return True

    def _fallback_queries(self, hypothesis: str) -> dict:
        """Generate basic queries when LLM is unavailable."""
        raw_keyword = hypothesis.split()[0] if hypothesis else "alert"
        keyword = re.sub(r"[^a-zA-Z0-9_.:-]", "", raw_keyword)[:64] or "alert"
        keyword_pattern = f"%{keyword}%"
        return {
            "queries": [
                {
                    "description": f"Search events matching '{keyword}'",
                    "sql": "SELECT id, timestamp, event_type, severity, source_ip, dest_ip, signature "
                           "FROM security_events WHERE user_id = :user_id "
                           "AND (signature LIKE :keyword OR category LIKE :keyword) "
                           "ORDER BY timestamp DESC LIMIT 50",
                    "params": {"keyword": keyword_pattern},
                },
                {
                    "description": "High severity events in last 24h",
                    "sql": "SELECT id, timestamp, event_type, severity, source_ip, dest_ip, signature "
                           "FROM security_events WHERE user_id = :user_id "
                           "AND severity IN ('critical', 'high') "
                           "ORDER BY timestamp DESC LIMIT 50",
                },
            ],
            "sigma_rule": None,
            "explanation": f"Fallback queries searching for '{keyword}' in signatures and categories.",
        }
