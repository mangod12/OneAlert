"""Hunt Agent — natural-language threat hunting with query generation."""

import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta

from backend.models.security_event import SecurityEvent
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import TASK_HUNT, get_ai_provider
from backend.services.hunt_select import compile_hunt_select

logger = logging.getLogger(__name__)

DEFAULT_HUNT_COLUMNS = (
    "id",
    "timestamp",
    "event_type",
    "severity",
    "source_ip",
    "dest_ip",
    "signature",
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
    "signature",
    "category",
    "hostname",
    "username",
    "domain",
    "url",
    "user_agent",
}

EQUALITY_FILTER_COLUMNS = {
    "event_type",
    "severity",
    "source_ip",
    "dest_ip",
    "protocol",
    "action",
    "source_type",
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
- Time filters must use timestamp >= :since and/or timestamp < :before with AND
- Include since/before in each query params object as timezone-aware ISO8601 timestamps
- Use the supplied current UTC time for relative windows; do not invent a date
- Do not use timestamp functions, literal dates, BETWEEN, or OR for time windows
- Only SELECT unique supported simple columns, or * for the standard evidence columns; no aliases or expressions
- FROM security_events WHERE user_id = :user_id must start every query's scope
- Additional AND equality predicates: event_type/severity/source_ip/dest_ip/protocol/action/source_type = 'literal'
- Text predicates: signature/category/hostname/username/domain/url/user_agent LIKE 'literal'
- Severity predicate: severity IN ('literal', ...), at most 10 values
- Keyword group: (signature LIKE :keyword OR category LIKE :keyword), with nonempty text in params
- ORDER BY one supported column with optional ASC/DESC; defaults to timestamp DESC with id as a stable tie-breaker
- Optional positive integer LIMIT, capped at 100. Do not use LIMIT 0
- No joins, aggregates, functions, aliases, subqueries, arbitrary OR/NOT, comments or semicolons
- No GROUP BY, HAVING or UNION
- Unsupported syntax is rejected, never silently ignored
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
            response = await provider.complete_json(
                [
                    AIMessage(role="system", content=HUNT_SYSTEM_PROMPT),
                    AIMessage(
                        role="user",
                        content=f"Current UTC time: {datetime.now(UTC).isoformat()}\nHunting hypothesis: {hypothesis}",
                    ),
                ]
            )
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
        if not isinstance(response, dict):
            return self._finish_result(hypothesis, {}, [], "Generated hunt response must be an object")
        queries = response.get("queries", [])
        if not isinstance(queries, list):
            return self._finish_result(hypothesis, response, [], "Generated hunt queries must be a list")
        results = []

        for q in queries[:3]:  # Max 3 queries
            if not isinstance(q, dict):
                results.append(
                    {"query": {}, "outcome": "rejected", "error": "Generated query must be an object", "rows": []}
                )
                continue
            if not isinstance(q.get("sql"), str) or not isinstance(q.get("description", ""), str):
                results.append(
                    {"query": {}, "outcome": "rejected", "error": "Query SQL and description must be text", "rows": []}
                )
                continue
            sql = q.get("sql", "")
            if not self._is_safe_query(sql):
                results.append(
                    {
                        "query": q,
                        "outcome": "rejected",
                        "error": "Query rejected: use a single scoped, read-only SELECT",
                        "rows": [],
                    }
                )
                continue

            start = time.time()
            executing = False
            recorded = False
            try:
                params = q.get("params", {})
                compiled = self._compile_query(sql, params)
                executing = True
                query_results = await self._execute_compiled_query(compiled.query)
                results.append(
                    {
                        "query": q,
                        "outcome": "completed",
                        "rows": query_results[:100],  # Cap at 100 rows
                        "row_count": len(query_results),
                        "execution": compiled.evidence,
                        "time_window": {
                            key: value.isoformat() for key, value in self._timestamp_bounds(sql, params).items()
                        },
                    }
                )
                recorded = True
                await self.log_step(
                    "execute_query",
                    q.get("description", ""),
                    output_summary=f"{len(query_results)} rows returned",
                    tool_used="database",
                    duration_ms=int((time.time() - start) * 1000),
                )
            except Exception as e:
                if recorded:
                    raise  # Ledger failure is not a second query outcome.
                results.append(
                    {"query": q, "outcome": "failed" if executing else "rejected", "error": str(e), "rows": []}
                )
                await self.log_step("query_error", str(e))

        return self._finish_result(hypothesis, response, results)

    def _finish_result(self, hypothesis, response, results, error=None):
        completed = sum(result.get("outcome") == "completed" for result in results)
        rejected = sum(result.get("outcome") == "rejected" for result in results)
        failed = sum(result.get("outcome") == "failed" for result in results)
        status = "completed" if completed and completed == len(results) else "partial" if completed else "failed"
        queries = response.get("queries", [])
        skipped = max(0, len(queries) - 3) if isinstance(queries, list) else 0
        if skipped and status == "completed":
            status = "partial"
        output = {
            "hypothesis": hypothesis,
            "status": status,
            "recorded_at": datetime.now(UTC).isoformat(),
            "query_results": results,
            "execution_summary": {
                "completed": completed,
                "rejected": rejected,
                "failed": failed,
                "attempted": completed + failed,
                "skipped": skipped,
            },
            "sigma_rule": response.get("sigma_rule") if isinstance(response.get("sigma_rule"), str) else None,
            "explanation": response.get("explanation") if isinstance(response.get("explanation"), str) else None,
            "summary": f"{completed} queries completed, {rejected} rejected before execution, "
            f"{failed} execution errors, {skipped} skipped by the three-query cap",
        }
        if error or not results:
            output["error"] = error or "No hunt queries were generated"
        return output

    async def _execute_query(self, sql: str, params: dict | None = None) -> list:
        """Execute a read-only SQL query with user_id scoping."""
        query = self._build_safe_query(sql, {} if params is None else params)
        return await self._execute_compiled_query(query)

    async def _execute_compiled_query(self, query) -> list:
        # A failed SELECT must not poison the outer session transaction or lose
        # other query evidence. The outer hunt/session write commits separately.
        async with self.db.begin_nested():
            result = await self.db.execute(query)
            columns = result.keys()
            return [dict(zip(columns, row, strict=True)) for row in result.fetchall()]

    def _build_safe_query(self, sql: str, params: dict) -> object:
        """Build a constrained SQLAlchemy query from validated hunt SQL."""
        return self._compile_query(sql, params).query

    def _compile_query(self, sql: str, params: dict):
        if not isinstance(sql, str) or len(sql) > 12000 or not isinstance(params, dict):
            raise ValueError("Hunt SQL must be text and params must be an object")
        bounds = self._timestamp_bounds(sql, params)
        return compile_hunt_select(
            sql,
            params,
            self.user_id,
            SecurityEvent.user_id,
            ALLOWED_HUNT_COLUMNS,
            DEFAULT_HUNT_COLUMNS,
            EQUALITY_FILTER_COLUMNS,
            TEXT_FILTER_COLUMNS,
            bounds,
        )

    def _timestamp_bounds(self, sql: str, params: dict) -> dict[str, datetime]:
        """Apply only explicit UTC-normalized, inclusive/exclusive time bounds.

        Unsupported time predicates fail rather than silently widening a hunt.
        This is not a general SQL interpreter.
        """
        sanitized = re.sub(r"'(?:[^']|'')*'", "'<literal>'", sql)
        match = re.search(r"\bWHERE\b(.*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)", sanitized, re.IGNORECASE | re.DOTALL)
        if not match:
            return {}
        clause = match.group(1)
        # Ignore words inside literal text when identifying time predicates.
        remaining = clause
        bounds = {}
        for key, operator in (("since", ">="), ("before", "<")):
            pattern = rf"(?:^\s*|\bAND\s+)timestamp\s*{re.escape(operator)}\s*:{key}\b(?=\s*(?:AND\b|$))"
            matches = re.findall(pattern, remaining, re.IGNORECASE)
            if not matches:
                continue
            if len(matches) != 1:
                raise ValueError("Repeated timestamp bounds are not supported")
            raw = params.get(key)
            if not isinstance(raw, str):
                raise ValueError(f"Time bound :{key} needs a timezone-aware ISO8601 parameter")
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError(f"Time bound :{key} is not a valid ISO8601 timestamp") from exc
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError(f"Time bound :{key} must include a timezone")
            bounds[key] = parsed.astimezone(UTC)
            remaining = re.sub(pattern, "<time-bound>", remaining, flags=re.IGNORECASE)
        if re.search(r"\btimestamp\b", remaining, re.IGNORECASE) or (
            bounds and re.search(r"\b(?:OR|NOT)\b", remaining, re.IGNORECASE)
        ):
            raise ValueError(
                "Unsupported time predicate. Use timestamp >= :since and/or timestamp < :before joined with AND"
            )
        if "since" in bounds and "before" in bounds and bounds["since"] >= bounds["before"]:
            raise ValueError("Time window start must be earlier than its end")
        return bounds

    def _is_safe_query(self, sql: str) -> bool:
        """Validate a generated hunt query is a single scoped read-only SELECT."""
        if not isinstance(sql, str):
            return False
        normalized = " ".join(sql.strip().split())
        upper = normalized.upper()
        if not upper.startswith("SELECT "):
            return False
        if not normalized or ";" in normalized or "--" in normalized or "/*" in normalized or "*/" in normalized:
            return False

        dangerous = (
            "INSERT",
            "UPDATE",
            "DELETE",
            "DROP",
            "ALTER",
            "CREATE",
            "TRUNCATE",
            "EXEC",
            "EXECUTE",
            "GRANT",
            "REVOKE",
            "MERGE",
            "CALL",
            "COPY",
            "ATTACH",
            "DETACH",
            "PRAGMA",
            "VACUUM",
        )
        if re.search(rf"\b({'|'.join(dangerous)})\b", upper):
            return False
        if not re.search(r"\bFROM\s+security_events\b", normalized, re.IGNORECASE):
            return False
        # bool() is required: callers and tests rely on a strict True/False return.
        return bool(re.search(r"\buser_id\s*=\s*:user_id\b", normalized, re.IGNORECASE))

    def _fallback_queries(self, hypothesis: str) -> dict:
        """Generate basic queries when LLM is unavailable."""
        now = datetime.now(UTC)
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
                    "AND severity IN ('critical', 'high') AND timestamp >= :since AND timestamp < :before "
                    "ORDER BY timestamp DESC LIMIT 50",
                    "params": {"since": (now - timedelta(hours=24)).isoformat(), "before": now.isoformat()},
                },
            ],
            "sigma_rule": None,
            "explanation": f"Fallback queries searching for '{keyword}' in signatures and categories.",
        }
