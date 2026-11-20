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
    total = (await db.execute(select(func.count()).select_from(statement.subquery()))).scalar_one()
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
            "date_basis": today,
            "scope": "Current records you explicitly follow. Counts and pages can change between reads; "
                     "not a historical or atomic snapshot. Due filtering uses UTC calendar dates."}
