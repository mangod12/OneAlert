"""Read the exact case and remaining checklist/alert work before close-out."""
import hashlib
import json

from sqlalchemy import select

from backend.models.alert import Alert
from backend.models.case import CaseAlert, CaseTask


async def closeout_review(db, case, user_id, target_status, *, lock=False):
    tasks_query = select(CaseTask).where(CaseTask.case_id == case.id).order_by(CaseTask.id)
    alerts_query = select(Alert).join(CaseAlert, CaseAlert.alert_id == Alert.id).where(
        CaseAlert.case_id == case.id, Alert.user_id == case.user_id).order_by(Alert.id)
    if lock:
        tasks_query = tasks_query.with_for_update()
        alerts_query = alerts_query.with_for_update()
    tasks = (await db.execute(tasks_query)).scalars().all()
    alerts = (await db.execute(alerts_query)).scalars().all()
    link_ids = (await db.execute(select(CaseAlert.alert_id).where(CaseAlert.case_id == case.id)
                                 .order_by(CaseAlert.alert_id))).scalars().all()
    task_rows = [{"id": row.id, "title": row.title, "done": row.done, "assignee_id": row.assignee_id,
                  "due_date": row.due_date.isoformat() if row.due_date else None} for row in tasks]
    alert_rows = [{"id": row.id, "title": row.title, "status": row.status, "severity": row.severity} for row in alerts]
    source = {"case_id": case.id, "title": case.title, "status": case.status, "target_status": target_status,
              "severity": case.severity, "resolution": case.resolution,
              "due_date": case.due_date.isoformat() if case.due_date else None,
              "assignee_id": case.assigned_to_id, "owner_id": case.user_id,
              "tasks": task_rows, "alerts": alert_rows, "linked_alert_ids": link_ids}
    fingerprint = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    remaining_alerts = [row for row in alert_rows if row["status"] not in {"resolved", "false_positive"}]
    return {"case_id": case.id, "title": case.title, "status": case.status, "target_status": target_status,
            "resolution": case.resolution, "can_edit_resolution": case.user_id == user_id,
            "open_tasks": [row for row in task_rows if not row["done"]], "task_total": len(tasks),
            "remaining_alerts": remaining_alerts, "alert_total": len(alerts),
            "unavailable_alert_links": len(link_ids) - len(alerts), "reviewed_fingerprint": fingerprint}
