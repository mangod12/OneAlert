"""Saved alerts-list filter views."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.saved_view import SavedView, SavedViewCreate, SavedViewResponse
from backend.models.user import User

router = APIRouter()

MAX_VIEWS_PER_USER = 25


@router.get("/", response_model=list[SavedViewResponse])
async def list_saved_views(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's saved views, oldest first."""
    result = await db.execute(
        select(SavedView).where(SavedView.user_id == current_user.id).order_by(SavedView.created_at, SavedView.id)
    )
    return list(result.scalars().all())


@router.post("/", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
async def create_saved_view(
    payload: SavedViewCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Save the current alerts filters under a name. Names are unique per user."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="View name cannot be blank")
    existing = await db.execute(
        select(func.count(SavedView.id)).where(SavedView.user_id == current_user.id)
    )
    if (existing.scalar() or 0) >= MAX_VIEWS_PER_USER:
        raise HTTPException(status_code=400, detail=f"Saved views are limited to {MAX_VIEWS_PER_USER} per user")
    duplicate = await db.execute(
        select(SavedView).where(SavedView.user_id == current_user.id, func.lower(SavedView.name) == name.lower())
    )
    if duplicate.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="A saved view with this name already exists")
    view = SavedView(
        user_id=current_user.id,
        name=name,
        filters=payload.filters.model_dump(exclude_none=True),
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


@router.delete("/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_view(
    view_id: int,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Delete one of the current user's saved views."""
    result = await db.execute(
        select(SavedView).where(SavedView.id == view_id, SavedView.user_id == current_user.id)
    )
    view = result.scalar_one_or_none()
    if view is None:
        raise HTTPException(status_code=404, detail="Saved view not found")
    await db.delete(view)
    await db.commit()
