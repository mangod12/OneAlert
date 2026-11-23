"""Review exact task due dates and the reminder reset caused by a change."""
import hashlib
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from backend.services.case_task_deletion_review import task_deletion_review


class TaskDueProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    due_date: date | None


async def task_due_review(db, case, actor, task_id, due_date, *, lock=False):
    source = await task_deletion_review(db, case, actor, task_id, lock=lock, allow_assigned=True)
    proposed = due_date.isoformat() if due_date is not None else None
    saved = source['task']['due_date']
    if (saved.isoformat() if saved is not None else None) == proposed:
        raise HTTPException(status_code=409, detail='The task already has this exact due date')
    digest = hashlib.sha256((source['reviewed_fingerprint'] + '\ndue:' + str(proposed)).encode()).hexdigest()
    return source | {'proposed_due_date': proposed, 'reviewed_fingerprint': digest}
