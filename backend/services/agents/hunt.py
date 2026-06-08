"""Hunt Agent — natural-language threat hunting with query generation."""

import logging
import time
import json
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import get_ai_provider, TASK_HUNT

logger = logging.getLogger(__name__)

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
        query_params = {"user_id": self.user_id}
        if params:
            query_params.update(params)
        result = await self.db.execute(text(sql), query_params)
        columns = result.keys()
        rows = []
        for row in result.fetchall():
            rows.append(dict(zip(columns, row)))
        return rows

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
