"""Saved query drafts separate generation from explicit selected-query execution."""

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta

from backend.services.agents.hunt import HuntAgent

FORMAT = "onealert_hunt_query_draft_v1"


def normalized_query(agent, query, position):
    item = {
        "position": position,
        "description": "",
        "description_shortened": False,
        "sql": None,
        "params": {},
        "accepted": False,
        "execution": None,
        "time_window": {},
        "error": None,
    }
    if not isinstance(query, dict):
        item["error"] = "Generated query must be an object"
        return item
    description = query.get("description", "")
    if isinstance(description, str):
        item.update(description=description[:1000], description_shortened=len(description) > 1000)
    sql, params = query.get("sql"), query.get("params", {})
    if isinstance(sql, str) and len(sql) <= 12000:
        item["sql"] = sql
    if (
        not isinstance(description, str)
        or item["sql"] is None
        or not isinstance(params, dict)
        or set(params) - {"since", "before", "keyword"}
        or any(not isinstance(value, str) or not value or len(value) > 2048 for value in params.values())
    ):
        item["error"] = "Query text, description or bounded supported parameters are invalid"
        return item
    unquoted = re.sub(r"'(?:[^']|'')*'", "'literal'", sql)
    used = set(re.findall(r":([A-Za-z_]\w*)", unquoted)) - {"user_id"}
    if set(params) != used:
        item["error"] = "Parameters must exactly match the supported placeholders used by this query"
        return item
    item["params"] = params.copy()
    try:
        if not agent._is_safe_query(sql):
            raise ValueError("Use one scoped read-only SELECT from security_events")
        compiled = agent._compile_query(sql, params)
        item.update(
            accepted=True,
            execution=compiled.evidence,
            time_window={key: value.isoformat() for key, value in agent._timestamp_bounds(sql, params).items()},
        )
    except ValueError as exc:
        item["error"] = str(exc)
    return item


def draft_fingerprint(session_id, hypothesis, draft):
    try:
        raw = json.dumps(
            {"session_id": session_id, "hypothesis": hypothesis, "draft": draft},
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        if len(raw) > 1000000:
            raise ValueError("Saved draft exceeds its supported bound")
        return hashlib.sha256(raw.encode()).hexdigest()
    except (TypeError, RecursionError) as exc:
        raise ValueError("Saved query draft has an unsupported format") from exc


def read_draft(session):
    data = session.result_data
    draft = data.get("query_draft") if isinstance(data, dict) else None
    if session.status != "prepared" or not isinstance(draft, dict) or draft.get("format") != FORMAT:
        raise ValueError("This session is not a supported saved query draft")
    queries = draft.get("queries")
    if (
        not isinstance(queries, list)
        or not 1 <= len(queries) <= 3
        or any(
            not isinstance(query, dict)
            or type(query.get("position")) is not int
            or query["position"] != index + 1
            or type(query.get("accepted")) is not bool
            for index, query in enumerate(queries)
        )
    ):
        raise ValueError("Saved draft query selection is unsupported")
    try:
        prepared = datetime.fromisoformat(draft["prepared_at"])
        expires = datetime.fromisoformat(draft["expires_at"])
        if prepared.utcoffset() is None or expires.utcoffset() is None or expires - prepared != timedelta(hours=1):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Saved draft timing is unsupported") from exc
    return draft, draft_fingerprint(session.id, session.hypothesis, draft), prepared, expires


class HuntQueryDraftAgent(HuntAgent):
    async def run(self, **kwargs):
        hypothesis = kwargs["hypothesis"]
        response = await self._generate_response(hypothesis)
        queries = response.get("queries") if isinstance(response, dict) else None
        if not isinstance(queries, list) or not queries:
            return {
                "status": "failed",
                "error": "No supported query draft was generated. No event SELECT was executed.",
                "summary": "Query draft generation failed; no event query executed.",
            }
        now = datetime.now(UTC)
        explanation = response.get("explanation")
        draft = {
            "format": FORMAT,
            "prepared_at": now.isoformat(),
            "expires_at": (now + timedelta(hours=1)).isoformat(),
            "generation_method": getattr(self, "_generation_method", "not_recorded"),
            "generated_query_count": len(queries),
            "omitted_query_count": max(0, len(queries) - 3),
            "queries": [normalized_query(self, query, index + 1) for index, query in enumerate(queries[:3])],
            "explanation": explanation[:4000] if isinstance(explanation, str) else None,
            "explanation_shortened": isinstance(explanation, str) and len(explanation) > 4000,
            "scope": "Compilation only, no event SELECT, scan or finding. Owner scope, supported fields, "
            "ordering, limits and supplied absolute time bounds are validated, not event existence or "
            "query cost. Selecting queries later reads then-current owned events with these fixed "
            "bounds, without regenerating SQL or advancing the time window. Draft expires after one hour.",
        }
        await self.log_step(
            "prepare_hunt_query_draft",
            "No event query execution requested",
            output_summary=f"{sum(query['accepted'] for query in draft['queries'])} supported query drafts; "
            f"{draft['omitted_query_count']} omitted by the three-query cap. No event SELECT executed.",
            tool_used="query_compiler",
        )
        return {
            "status": "prepared",
            "recorded_at": now.isoformat(),
            "query_draft": draft,
            "summary": "Saved query draft prepared. No event SELECT executed; no findings are claimed.",
        }


class ReviewedHuntQueriesAgent(HuntAgent):
    def __init__(self, db, user_id, source_id, fingerprint, selected, queries):
        super().__init__(db, user_id)
        self.source_id, self.fingerprint, self.selected, self.reviewed_queries = (
            source_id,
            fingerprint,
            selected,
            queries,
        )

    async def _generate_response(self, hypothesis):
        await self.log_step(
            "use_reviewed_hunt_query_draft",
            f"Saved draft #{self.source_id}; selected original queries {self.selected}",
            output_summary="Exact saved selected SQL and parameters. No provider call or time-window advance.",
            tool_used="saved_hunt_draft",
        )
        return {
            "queries": self.reviewed_queries,
            "explanation": "Executed the explicitly selected saved query drafts without a new AI call.",
            "sigma_rule": None,
        }

    async def run(self, **kwargs):
        result = await super().run(**kwargs)
        return {
            **result,
            "reviewed_draft": {
                "session_id": self.source_id,
                "fingerprint": self.fingerprint,
                "query_numbers": self.selected,
                "scope": "Selected saved queries only; current owned rows, not the earlier draft snapshot.",
            },
        }
