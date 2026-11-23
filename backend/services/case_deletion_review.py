"""Owner-only exact inventory for permanent investigation removal."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from backend.models.case import CaseAlert, CaseEvent, CaseTask, CaseTimeline, CaseWatcher
from backend.models.response_plan import ApprovalRequest, ResponsePlan


async def deletion_review(db, case, *, lock=False):
    def values(row):
        return {column.name: getattr(row, column.name) for column in row.__table__.columns}

    inventory = {}
    for name, model in [('tasks', CaseTask), ('watchers', CaseWatcher), ('alert_links', CaseAlert),
                        ('event_links', CaseEvent), ('timeline', CaseTimeline), ('response_plans', ResponsePlan)]:
        query = select(model).where(model.case_id == case.id).order_by(model.id).limit(501)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        rows = (await db.execute(query)).scalars().all()
        if len(rows) > 500:
            raise HTTPException(status_code=409, detail='Investigation inventory exceeds the complete review limit')
        inventory[name] = [values(row) for row in rows]
    plan_ids = [row['id'] for row in inventory['response_plans']]
    query = select(ApprovalRequest).where(ApprovalRequest.plan_id.in_(plan_ids)).order_by(ApprovalRequest.id).limit(501)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    approvals = (await db.execute(query)).scalars().all()
    if len(approvals) > 500:
        raise HTTPException(status_code=409, detail='Approval inventory exceeds the complete review limit')
    inventory['approvals'] = [values(row) for row in approvals]
    source = {'schema_version': 1, 'case': values(case), 'inventory': inventory}
    encoded = json.dumps(source, sort_keys=True, separators=(',', ':'), default=str)
    return {**json.loads(encoded), 'reviewed_fingerprint': hashlib.sha256(encoded.encode()).hexdigest()}
