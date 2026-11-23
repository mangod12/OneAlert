"""Bind checklist wording changes to the exact saved task and replacement title."""
import hashlib

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, StrictStr

from backend.services.case_task_deletion_review import task_deletion_review


class TaskTitleProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: StrictStr


async def task_title_review(db, case, actor, task_id, title, *, lock=False):
    title = title.strip()
    if not title or len(title) > 300:
        raise HTTPException(status_code=422, detail='Task title must contain 1 to 300 characters')
    source = await task_deletion_review(db, case, actor, task_id, lock=lock)
    if source['task']['title'] == title:
        raise HTTPException(status_code=409, detail='The task already has this exact title')
    digest = hashlib.sha256((source['reviewed_fingerprint'] + '\n' + title).encode()).hexdigest()
    return source | {'proposed_title': title, 'reviewed_fingerprint': digest}
