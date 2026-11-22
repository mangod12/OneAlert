"""In-app notification feed endpoints."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.notification import Notification, NotificationResponse
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.notification_policy import router as policy_router

router = APIRouter()
router.include_router(policy_router)


@router.get("/")
async def list_notifications(
    unread_only: bool = Query(False),
    query: str | None = Query(None, max_length=200),
    kind: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the current user's notifications, newest first. Muted kinds are hidden."""
    muted = current_user.muted_kinds or []
    base = select(Notification).where(Notification.user_id == current_user.id)
    count_q = select(func.count(Notification.id)).where(
        Notification.user_id == current_user.id
    )
    if muted:
        base = base.where(Notification.kind.notin_(muted))
        count_q = count_q.where(Notification.kind.notin_(muted))
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
        count_q = count_q.where(Notification.read_at.is_(None))
    if kind:
        base = base.where(Notification.kind == kind)
        count_q = count_q.where(Notification.kind == kind)

    if query and query.strip():
        text_scope = _notification_text_scope(query.strip())
        base = base.where(text_scope)
        count_q = count_q.where(text_scope)
    total = (await db.execute(count_q)).scalar_one()
    unread_count = (await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
            Notification.kind.notin_(muted),
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


def _notification_text_scope(query: str):
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return or_(Notification.title.ilike(f"%{escaped}%", escape="\\"),
               Notification.body.ilike(f"%{escaped}%", escape="\\"))


class NotificationBatchReview(BaseModel):
    operation: Literal["mark_read", "delete_read"]
    query: str | None = Field(None, max_length=200)
    kind: str | None = Field(None, max_length=100)
    ids: list[Annotated[int, Field(strict=True, ge=1)]] = Field(min_length=1, max_length=100)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("ids")
    @classmethod
    def exact_ids(cls, values):
        if any(value < 1 for value in values) or len(values) != len(set(values)):
            raise ValueError("Use unique positive notification IDs")
        return values


def _notification_review_query(user: User, operation: str, kind: str | None, text: str | None = None):
    query = select(Notification).where(Notification.user_id == user.id)
    if user.muted_kinds:
        query = query.where(Notification.kind.notin_(user.muted_kinds))
    if kind:
        query = query.where(Notification.kind == kind)
    if text:
        query = query.where(_notification_text_scope(text))
    return query.where(Notification.read_at.is_(None) if operation == "mark_read"
                       else Notification.read_at.isnot(None))


def _notification_review_fingerprint(user_id: int, operation: str, kind: str | None, rows, text: str | None = None):
    record = {"user_id": user_id, "operation": operation, "kind": kind, "query": text,
              "rows": [NotificationResponse.model_validate(row).model_dump(mode="json")
                       for row in sorted(rows, key=lambda row: row.id)]}
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@router.get("/review-batch")
async def preview_notification_batch(
    operation: Literal["mark_read", "delete_read"], kind: str | None = Query(None, max_length=100),
    query: str | None = Query(None, max_length=200),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Preview up to 100 exact visible notifications, excluding muted kinds."""
    text = query.strip() if query and query.strip() else None
    query = _notification_review_query(current_user, operation, kind, text)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.execute(query.order_by(Notification.created_at.desc(), Notification.id.desc())
                             .limit(100))).scalars().all()
    return {"operation": operation, "kind": kind, "query": text, "total": total,
            "records": [NotificationResponse.model_validate(row) for row in rows],
            "fingerprint": _notification_review_fingerprint(current_user.id, operation, kind, rows, text),
            "scope": "Exact reviewed IDs only, at most 100 newest matching records. Muted types excluded. "
                     "Notifications arriving after review are not included."}


@router.post("/review-batch")
async def apply_notification_batch(
    payload: NotificationBatchReview,
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    """Apply one reviewed batch after checking every row; never expand to new arrivals."""
    text = payload.query.strip() if payload.query and payload.query.strip() else None
    rows = (await db.execute(_notification_review_query(current_user, payload.operation, payload.kind, text)
                            .where(Notification.id.in_(payload.ids)).order_by(Notification.id).with_for_update())).scalars().all()
    fingerprint = _notification_review_fingerprint(current_user.id, payload.operation, payload.kind, rows, text)
    if len(rows) != len(payload.ids) or fingerprint != payload.fingerprint:
        raise HTTPException(status_code=409, detail="The reviewed notification records changed. "
                            "Reload the review; no changes applied.")
    now = datetime.now(UTC)
    for row in rows:
        if payload.operation == "mark_read":
            row.read_at = now
        else:
            await db.delete(row)
    await db.commit()
    return {"success": True, "operation": payload.operation, "ids": sorted(payload.ids), "affected": len(rows)}


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


@router.delete("/read")
async def delete_read_notifications(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete every read notification for the current user. Unread ones are kept."""
    rows = (await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.read_at.isnot(None),
        )
    )).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.commit()
    return {"success": True, "deleted": len(rows)}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete one notification."""
    notification = (await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.delete(notification)
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
