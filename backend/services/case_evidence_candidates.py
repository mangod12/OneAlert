"""Search linkable owned evidence without a recent-record cutoff."""
from sqlalchemy import String, cast, func, or_, select

from backend.models.alert import Alert
from backend.models.case import CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent


async def evidence_candidates(db, user_id, case_id, *, kind, page, size, query, severity):
    model = Alert if kind == "alert" else SecurityEvent
    linked = select(CaseAlert.alert_id).where(CaseAlert.case_id == case_id) if kind == "alert" else (
        select(CaseEvent.event_id).where(CaseEvent.case_id == case_id))
    statement = select(model).where(model.user_id == user_id, model.id.notin_(linked))
    if query.strip():
        fields = (Alert.id, Alert.title, Alert.cve_id, Alert.description) if kind == "alert" else (
            SecurityEvent.id, SecurityEvent.signature, SecurityEvent.event_type,
            SecurityEvent.source_ip, SecurityEvent.dest_ip)
        needle = query.strip().lower()
        statement = statement.where(or_(*[
            func.lower(func.coalesce(cast(field, String), "")).contains(needle, autoescape=True) for field in fields]))
    if severity != "all":
        statement = statement.where(model.severity == severity)
    total = (await db.execute(select(func.count()).select_from(statement.subquery()))).scalar_one()
    timestamp = Alert.created_at if kind == "alert" else SecurityEvent.timestamp
    rows = (await db.execute(statement.order_by(timestamp.desc().nulls_last(), model.id.desc())
                             .offset((page - 1) * size).limit(size))).scalars().all()
    data = [{"id": row.id, "kind": kind, "severity": row.severity,
             "title": row.title if kind == "alert" else row.signature or f"{row.event_type} event",
             "detail": row.cve_id if kind == "alert" else f"{row.source_ip or '(no source IP)'} → "
                       f"{row.dest_ip or '(no destination IP)'}",
             "timestamp": row.created_at if kind == "alert" else row.timestamp} for row in rows]
    return {"data": data, "total": total, "page": page, "size": size, "kind": kind, "case_id": case_id}
