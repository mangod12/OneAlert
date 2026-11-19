"""Notes attached to alerts."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert, AlertWatcher
from backend.models.alert_note import AlertNote, AlertNoteCreate, AlertNoteResponse
from backend.models.audit_log import AuditLog
from backend.models.user import User

router = APIRouter()


async def _owned_alert(alert_id: int, user: User, db: AsyncSession) -> Alert:
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


async def _visible_alert(alert_id: int, user: User, db: AsyncSession) -> Alert:
    """Alert the user may open and annotate: their own, assigned, or watched."""
    watched = select(AlertWatcher.alert_id).where(AlertWatcher.user_id == user.id)
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(
                Alert.user_id == user.id,
                Alert.assigned_to_id == user.id,
                Alert.id.in_(watched),
            ),
        )
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/{alert_id}/notes", response_model=list[AlertNoteResponse])
async def list_alert_notes(
    alert_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List an alert's notes, oldest first."""
    await _visible_alert(alert_id, current_user, db)
    result = await db.execute(
        select(AlertNote).where(AlertNote.alert_id == alert_id).order_by(AlertNote.created_at, AlertNote.id)
    )
    return list(result.scalars().all())


@router.get("/{alert_id}/activity")
async def list_alert_activity(
    alert_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List audit-trail entries for an alert, newest first (max 50)."""
    await _visible_alert(alert_id, current_user, db)
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.target_type == "alert", AuditLog.target_id == alert_id)
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(50)
    )
    return [
        {
            "id": log.id,
            "action": log.action,
            "detail": log.detail,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
        }
        for log in result.scalars().all()
    ]


@router.post("/{alert_id}/notes", response_model=AlertNoteResponse, status_code=status.HTTP_201_CREATED)
async def add_alert_note(
    alert_id: int,
    payload: AlertNoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Attach a note to an alert."""
    await _visible_alert(alert_id, current_user, db)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Note cannot be blank")
    note = AlertNote(alert_id=alert_id, user_id=current_user.id, body=body)
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


@router.delete("/{alert_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_note(
    alert_id: int,
    note_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a note from an alert."""
    await _owned_alert(alert_id, current_user, db)
    result = await db.execute(
        select(AlertNote).where(AlertNote.id == note_id, AlertNote.alert_id == alert_id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.delete(note)
    await db.commit()
