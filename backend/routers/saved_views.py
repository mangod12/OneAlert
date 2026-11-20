"""Saved filter views for the alerts, cases and events lists."""

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
    SavedViewRename,
    SavedViewResponse,
)
from backend.models.user import User

router = APIRouter()

MAX_VIEWS_PER_USER = 25


async def _name_conflict(
    db: AsyncSession,
    user_id: int,
    scope: str,
    name: str,
    exclude_id: int | None = None,
) -> bool:
    """True when the user already has a view with this name in the scope (case-insensitive)."""
    stmt = select(SavedView).where(
        SavedView.user_id == user_id,
        SavedView.scope == scope,
        func.lower(SavedView.name) == name.lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(SavedView.id != exclude_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


def _scope(request: Request) -> str:
    """Which list the view belongs to, from the mounted path."""
    path = request.url.path
    if "/cases/" in path:
        return "cases"
    if "/events/" in path:
        return "events"
    return "alerts"


@router.get("/alerts/views/", response_model=list[SavedViewResponse])
@router.get("/cases/views/", response_model=list[SavedViewResponse])
@router.get("/events/views/", response_model=list[SavedViewResponse])
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
@router.post("/events/views/", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
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
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc
    existing = await db.execute(
        select(func.count(SavedView.id)).where(
            SavedView.user_id == current_user.id, SavedView.scope == scope
        )
    )
    if (existing.scalar() or 0) >= MAX_VIEWS_PER_USER:
        raise HTTPException(status_code=400, detail=f"Saved views are limited to {MAX_VIEWS_PER_USER} per user")
    if await _name_conflict(db, current_user.id, scope, name):
        raise HTTPException(status_code=409, detail="A saved view with this name already exists")
    view = SavedView(
        user_id=current_user.id,
        scope=scope,
        name=name,
        filters=filters.model_dump(exclude_none=True, mode="json"),
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


@router.delete("/alerts/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/cases/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/events/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
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


@router.patch("/alerts/views/{view_id}", response_model=SavedViewResponse)
@router.patch("/cases/views/{view_id}", response_model=SavedViewResponse)
@router.patch("/events/views/{view_id}", response_model=SavedViewResponse)
async def rename_saved_view(
    view_id: int,
    payload: SavedViewRename,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Rename one of the current user's saved views. Filters are unchanged."""
    scope = _scope(request)
    result = await db.execute(
        select(SavedView).where(
            SavedView.id == view_id,
            SavedView.user_id == current_user.id,
            SavedView.scope == scope,
        )
    )
    view = result.scalar_one_or_none()
    if view is None:
        raise HTTPException(status_code=404, detail="Saved view not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="View name cannot be blank")
    if await _name_conflict(db, current_user.id, scope, name, exclude_id=view.id):
        raise HTTPException(status_code=409, detail="A saved view with this name already exists")
    view.name = name
    await db.commit()
    await db.refresh(view)
    return view
