"""Bounded database search across the caller's followed alerts and cases."""

from datetime import UTC, datetime

from sqlalchemy import String, cast, func, literal, or_, select, union_all
from sqlalchemy import case as sql_case

from backend.models.alert import Alert, AlertWatcher
from backend.models.asset import Asset
from backend.models.case import Case, CaseWatcher


async def search_watched_records(db, user_id, *, page, size, query, kind, severity, scope, sort):
    today = datetime.now(UTC).date()
    alerts = select(
        literal("alert").label("kind"), Alert.id.label("id"), Alert.title.label("title"),
        Alert.cve_id.label("cve_id"), Asset.name.label("asset_name"),
        Alert.severity.label("severity"), Alert.status.label("status"),
        Alert.created_at.label("created_at"), Alert.due_date.label("due_date"),
    ).outerjoin(Asset, Asset.id == Alert.asset_id).where(Alert.id.in_(
        select(AlertWatcher.alert_id).where(AlertWatcher.user_id == user_id)))
    cases = select(
        literal("case").label("kind"), Case.id.label("id"), Case.title.label("title"),
        cast(literal(None), String).label("cve_id"), cast(literal(None), String).label("asset_name"),
        Case.severity.label("severity"), Case.status.label("status"),
        Case.created_at.label("created_at"), Case.due_date.label("due_date"),
    ).where(Case.id.in_(select(CaseWatcher.case_id).where(CaseWatcher.user_id == user_id)))
    watched = union_all(alerts, cases).subquery()
    statement = select(watched)
    if query.strip():
        needle = query.strip().lower()
        statement = statement.where(or_(*[
            func.lower(func.coalesce(cast(column, String), "")).contains(needle, autoescape=True)
            for column in (watched.c.title, watched.c.cve_id, watched.c.asset_name, watched.c.id)
        ]))
    if kind != "all":
        statement = statement.where(watched.c.kind == kind)
    if severity != "all":
        statement = statement.where(watched.c.severity == severity)
    done = ("resolved", "closed", "false_positive")
    active = or_(watched.c.status.is_(None), watched.c.status.notin_(done))
    if scope == "active":
        statement = statement.where(active)
    elif scope == "done":
        statement = statement.where(watched.c.status.in_(done))
    elif scope == "overdue":
        statement = statement.where(active, watched.c.due_date < today)
    elif scope == "today":
        statement = statement.where(active, watched.c.due_date == today)
    elif scope == "future":
        statement = statement.where(active, watched.c.due_date > today)
    elif scope == "undated":
        statement = statement.where(active, watched.c.due_date.is_(None))
    # Aggregate the full filtered set before paging, never just the visible rows.
    matching = statement.subquery()
    matching_active = or_(matching.c.status.is_(None), matching.c.status.notin_(done))
    aggregates = (await db.execute(select(
        func.count().label("total"),
        func.coalesce(func.sum(sql_case((matching.c.kind == "alert", 1), else_=0)), 0).label("alerts"),
        func.coalesce(func.sum(sql_case((matching.c.kind == "case", 1), else_=0)), 0).label("cases"),
        func.coalesce(func.sum(sql_case((matching_active, 1), else_=0)), 0).label("active"),
        func.coalesce(func.sum(sql_case((matching.c.status.in_(done), 1), else_=0)), 0).label("done"),
        func.coalesce(func.sum(sql_case((matching_active & (matching.c.due_date < today), 1), else_=0)), 0)
        .label("overdue"),
        func.coalesce(func.sum(sql_case((matching_active & matching.c.due_date.is_(None), 1), else_=0)), 0)
        .label("active_without_due_date"),
    ).select_from(matching))).mappings().one()
    total = aggregates["total"]
    summary = {key: value for key, value in aggregates.items() if key != "total"}
    rank = sql_case({"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4},
                    value=watched.c.severity, else_=5)
    order = {
        "severity": [rank, watched.c.created_at.desc().nulls_last()],
        "newest": [watched.c.created_at.desc().nulls_last()],
        "oldest": [watched.c.created_at.asc().nulls_last()],
        "name": [func.lower(watched.c.title)],
        "due": [watched.c.due_date.asc().nulls_last(), rank],
    }[sort]
    records = (await db.execute(statement.order_by(*order, watched.c.kind, watched.c.id)
                               .offset((page - 1) * size).limit(size))).mappings().all()
    return {"data": [dict(row) for row in records], "total": total, "page": page, "size": size,
            "date_basis": today, "summary": summary,
            "scope": "Current records you explicitly follow. Counts and pages can change between reads; "
                     "not a historical or atomic snapshot. Due filtering uses UTC calendar dates."}
