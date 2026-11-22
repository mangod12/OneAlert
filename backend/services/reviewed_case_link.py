"""Shared owner-scoped destination review and lock order for exact evidence links."""
from typing import Annotated

from fastapi import HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from backend.models.case import Case

ExactEvidenceId = Annotated[int, Path(ge=1, le=9007199254740991)]


class ReviewedExistingInvestigation(BaseModel):
    reviewed_fingerprint: str = Field(pattern='^[a-f0-9]{64}$')
    model_config = {'extra': 'forbid'}


async def owned_existing_case(db, user_id, case_id, *, lock=False):
    # Match the case-first lock order used by the existing case evidence routes.
    if lock and db.bind.dialect.name == 'sqlite':
        await db.execute(update(Case).where(Case.id == case_id, Case.user_id == user_id)
                         .values(id=Case.id, updated_at=Case.updated_at))
    statement = select(Case).where(Case.id == case_id, Case.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    case = (await db.execute(statement)).scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail='Investigation not found')
    return case


