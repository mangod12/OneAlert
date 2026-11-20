"""Hunt Agent — natural-language threat hunting with query generation."""

import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from backend.models.security_event import SecurityEvent
from backend.services.agents.base import BaseAgent
from backend.services.ai.provider import AIMessage
from backend.services.ai.router import TASK_HUNT, get_ai_provider

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
    "processed",
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
                results.append(
                    {
                        "query": q,
                        "rows": query_results[:100],  # Cap at 100 rows
                        "row_count": len(query_results),
                        "time_window": {
                            key: value.isoformat()
                            for key, value in self._timestamp_bounds(sql, q.get("params") or {}).items()
                        },
                    }
                )
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
        return [dict(zip(columns, row, strict=True)) for row in result.fetchall()]

    def _build_safe_query(self, sql: str, params: dict) -> object:
        """Build a constrained SQLAlchemy query from validated hunt SQL."""
        selected = self._selected_columns(sql)
        query = select(*[ALLOWED_HUNT_COLUMNS[name].label(name) for name in selected])
        query = query.where(SecurityEvent.user_id == self.user_id)

        keyword = params.get("keyword")
        if keyword:
            query = query.where(
                or_(
                    SecurityEvent.signature.like(keyword),
                    SecurityEvent.category.like(keyword),
                )
            )

        query = self._apply_literal_filters(query, sql)
        bounds = self._timestamp_bounds(sql, params)
        if "since" in bounds:
            query = query.where(SecurityEvent.timestamp >= bounds["since"])
        if "before" in bounds:
            query = query.where(SecurityEvent.timestamp < bounds["before"])
        query = self._apply_ordering(query, sql)
        return query.limit(self._limit(sql))

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

    def _selected_columns(self, sql: str) -> list[str]:
        """Extract simple selected column names, falling back to a safe default."""
        upper_sql = sql.upper()
        select_idx = upper_sql.find("SELECT ")
        from_idx = upper_sql.find(" FROM SECURITY_EVENTS")
        if select_idx != 0 or from_idx <= len("SELECT "):
            return list(DEFAULT_HUNT_COLUMNS)

        raw_columns = [part.strip() for part in sql[len("SELECT ") : from_idx].split(",")]
        if raw_columns == ["*"]:
            return list(DEFAULT_HUNT_COLUMNS)

        selected = []
        for raw in raw_columns:
            upper_raw = raw.upper()
            alias_idx = upper_raw.rfind(" AS ")
            name = (raw[:alias_idx] if alias_idx >= 0 else raw).strip().lower()
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
