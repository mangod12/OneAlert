"""Review exact checklist completion and reopening without changing access."""
import hashlib

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, StrictBool

from backend.services.case_task_deletion_review import task_deletion_review


class TaskCompletionProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    done: StrictBool


async def task_completion_review(db, case, actor, task_id, done, *, lock=False):
    source = await task_deletion_review(db, case, actor, task_id, lock=lock, allow_assigned=True)
    if source['task']['done'] == done:
        raise HTTPException(status_code=409, detail='The task already has this completion state')
    digest = hashlib.sha256((source['reviewed_fingerprint'] + '\ndone:' + str(done)).encode()).hexdigest()
    return source | {'proposed_done': done, 'reviewed_fingerprint': digest}
