"""Bounded owner-only saved receipt metadata for one exact query draft."""

from datetime import UTC, datetime

from sqlalchemy import String, cast, func, select

from backend.models.case import AgentRun
from backend.models.detection_rule import HuntSession


def _positive_id(value):
    return type(value) is int and 1 <= value <= 2147483647


async def draft_execution_page(db, owner, source_id, fingerprint, draft, offset, limit):
    origin = HuntSession.result_data["reviewed_draft"]
    where = (
        HuntSession.user_id == owner,
        cast(origin["session_id"].as_string(), String) == str(source_id),
        origin["fingerprint"].as_string() == fingerprint,
    )
    total = (await db.execute(select(func.count()).select_from(HuntSession).where(*where))).scalar_one()
    # Do not load result_data, retained telemetry, SQL or query rows into this listing.
    rows = (
        await db.execute(
            select(
                HuntSession.id,
                HuntSession.status,
                HuntSession.created_at,
                HuntSession.queries_run,
                HuntSession.findings_count,
                origin.label("origin"),
                HuntSession.result_data["agent_run_id"].label("run_id"),
            )
            .where(*where)
            .order_by(HuntSession.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    run_ids = {row.run_id for row in rows if _positive_id(row.run_id)}
    verified_runs = (
        set(
            (
                await db.execute(
                    select(AgentRun.id).where(
                        AgentRun.id.in_(run_ids),
                        AgentRun.user_id == owner,
                        AgentRun.agent_type == "hunt",
                    )
                )
            ).scalars()
        )
        if run_ids
        else set()
    )
    executions = []
    for row in rows:
        receipt = row.origin if isinstance(row.origin, dict) else {}
        numbers, scope = receipt.get("query_numbers"), receipt.get("scope")
        supported = (
            row.id != source_id
            and row.status in {"completed", "partial", "failed"}
            and type(receipt.get("session_id")) is int
            and receipt["session_id"] == source_id
            and receipt.get("fingerprint") == fingerprint
            and isinstance(scope, str)
            and bool(scope.strip())
            and len(scope) <= 2000
            and isinstance(numbers, list)
            and 1 <= len(numbers) <= 3
            and all(
                type(number) is int
                and 1 <= number <= len(draft["queries"])
                and draft["queries"][number - 1]["accepted"]
                for number in numbers
            )
            and numbers == sorted(set(numbers))
        )
        executions.append(
            {
                "session_id": row.id,
                "status": row.status
                if row.status in {"completed", "partial", "failed", "running", "prepared"}
                else "unsupported",
                "created_at": row.created_at.isoformat() if row.created_at is not None else None,
                "receipt_supported": bool(supported),
                "query_numbers": numbers if supported else None,
                "agent_run_id": row.run_id if _positive_id(row.run_id) and row.run_id in verified_runs else None,
                "recorded_queries_run": row.queries_run
                if type(row.queries_run) is int and row.queries_run >= 0
                else None,
                "recorded_row_count": row.findings_count
                if type(row.findings_count) is int and row.findings_count >= 0
                else None,
            }
        )
    return {
        "source_session_id": source_id,
        "source_fingerprint": fingerprint,
        "read_at": datetime.now(UTC).isoformat(),
        "offset": offset,
        "limit": limit,
        "total": total,
        "executions": executions,
        "scope": "Saved owner records whose receipt claims this exact source ID and fingerprint. "
        "A supported receipt validates its source selection metadata, not complete query results or "
        "successful execution. Open each exact saved result and its audit to inspect retained contracts. "
        "Counts are saved metadata, not confirmed threats. No event SELECT, provider call, execution or "
        "automatic retry. Missing saved receipts do not prove no database query ran. This is not an "
        "atomic or live snapshot; new records can appear between pages or after a read.",
    }
