"""Saved filter views for the alerts and cases lists."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.saved_view import (
    FILTERS_MODELS,
    SavedView,
    SavedViewCreate,
    SavedViewResponse,
)
from backend.models.user import User

router = APIRouter()

MAX_VIEWS_PER_USER = 25


def _scope(request: Request) -> str:
    """Which list the view belongs to, from the mounted path."""
    return "cases" if "/cases/" in request.url.path else "alerts"


@router.get("/alerts/views/", response_model=list[SavedViewResponse])
@router.get("/cases/views/", response_model=list[SavedViewResponse])
async def list_saved_views(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's saved views for this list, oldest first."""
    result = await db.execute(
        select(SavedView)
        .where(SavedView.user_id == current_user.id, SavedView.scope == _scope(request))
        .order_by(SavedView.created_at, SavedView.id)
    )
    return list(result.scalars().all())


@router.post("/alerts/views/", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
@router.post("/cases/views/", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
async def create_saved_view(
    payload: SavedViewCreate,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Save the current list filters under a name. Names are unique per user and list."""
    scope = _scope(request)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="View name cannot be blank")
    try:
        filters = FILTERS_MODELS[scope].model_validate(payload.filters)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    existing = await db.execute(
        select(func.count(SavedView.id)).where(
            SavedView.user_id == current_user.id, SavedView.scope == scope
        )
    )
    if (existing.scalar() or 0) >= MAX_VIEWS_PER_USER:
        raise HTTPException(status_code=400, detail=f"Saved views are limited to {MAX_VIEWS_PER_USER} per user")
    duplicate = await db.execute(
        select(SavedView).where(
            SavedView.user_id == current_user.id,
            SavedView.scope == scope,
            func.lower(SavedView.name) == name.lower(),
        )
    )
    if duplicate.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="A saved view with this name already exists")
    view = SavedView(
        user_id=current_user.id,
        scope=scope,
        name=name,
        filters=filters.model_dump(exclude_none=True),
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


@router.delete("/alerts/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/cases/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_view(
    view_id: int,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Delete one of the current user's saved views for this list."""
    result = await db.execute(
        select(SavedView).where(
            SavedView.id == view_id,
            SavedView.user_id == current_user.id,
            SavedView.scope == _scope(request),
        )
    )
    view = result.scalar_one_or_none()
    if view is None:
        raise HTTPException(status_code=404, detail="Saved view not found")
    await db.delete(view)
    await db.commit()
