"""In-app notification feed endpoints."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.notification import Notification, NotificationResponse
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/")
async def list_notifications(
    unread_only: bool = Query(False),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the current user's notifications, newest first."""
    base = select(Notification).where(Notification.user_id == current_user.id)
    count_q = select(func.count(Notification.id)).where(
        Notification.user_id == current_user.id
    )
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
        count_q = count_q.where(Notification.read_at.is_(None))

    total = (await db.execute(count_q)).scalar_one()
    unread_count = (await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
    )).scalar_one()
    rows = (await db.execute(
        base.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * size).limit(size)
    )).scalars().all()

    return {
        "success": True,
        "data": [NotificationResponse.model_validate(r) for r in rows],
        "total": total,
        "unread_count": unread_count,
        "page": page,
        "size": size,
    }


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Mark one notification as read."""
    notification = (await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        await db.commit()
    return {"success": True}


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Mark every unread notification as read."""
    rows = (await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
    )).scalars().all()
    now = datetime.now(UTC)
    for row in rows:
        row.read_at = now
    await db.commit()
    return {"success": True, "marked": len(rows)}
