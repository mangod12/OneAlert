"""Notes attached to alerts."""

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.models.alert import Alert, AlertWatcher
from backend.models.alert_note import AlertNote, AlertNoteCreate, AlertNoteResponse
from backend.models.audit_log import AuditLog
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.investigation_notify import notify_investigation_event

router = APIRouter()

_MENTION_RE = re.compile(r"@([A-Za-z0-9._-]+)")


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
    notes = list(result.scalars().all())
    author_ids = {note.user_id for note in notes}
    if author_ids:
        authors = (await db.execute(
            select(User.id, User.email).where(User.id.in_(author_ids))
        )).all()
        email_by_id = dict(authors)
        for note in notes:
            note.user_email = email_by_id.get(note.user_id)
    return notes


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
    alert = await _visible_alert(alert_id, current_user, db)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Note cannot be blank")
    note = AlertNote(alert_id=alert_id, user_id=current_user.id, body=body)
    db.add(note)
    await db.flush()  # note.id feeds the mention deep links below

    # @mentions: "@will" pings will@<org> and, when the author can share the
    # alert (owner or assignee), adds them as a watcher so the link works and
    # they follow future status changes.
    mention_hits = {token.lower() for token in _MENTION_RE.findall(body)}
    notified: list[User] = []
    if mention_hits and current_user.org_id is not None:
        org_members = (await db.execute(
            select(User).where(
                User.org_id == current_user.org_id,
                User.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        targets = [
            u for u in org_members
            if u.id != current_user.id and u.email.split("@", 1)[0].lower() in mention_hits
        ]
        if targets:
            watcher_rows = (await db.execute(
                select(AlertWatcher.user_id).where(AlertWatcher.alert_id == alert_id)
            )).scalars().all()
            watcher_ids = set(watcher_rows)
            can_share = current_user.id in (alert.user_id, alert.assigned_to_id)
            excerpt = body if len(body) <= 140 else body[:137] + "..."
            for target in targets:
                has_access = (
                    target.id in (alert.user_id, alert.assigned_to_id)
                    or target.id in watcher_ids
                )
                if not has_access:
                    if not can_share:
                        continue  # a watcher cannot pull new people onto the alert
                    db.add(AlertWatcher(alert_id=alert_id, user_id=target.id))
                    watcher_ids.add(target.id)
                db.add(Notification(
                    user_id=target.id,
                    kind="alert_mention",
                    title=f"{current_user.email} mentioned you in alert #{alert_id}",
                    body=excerpt,
                    link=f"/app/alerts?alert={alert_id}&note={note.id}",
                ))
                notified.append(target)

    await db.commit()
    await db.refresh(note)

    for target in notified:
        await notify_investigation_event(
            target,
            kind="alert_mention",
            severity=alert.severity,
            title=f"{current_user.email} mentioned you in alert #{alert_id}",
            body=f"{alert.title or alert.cve_id}. Open the alert to read the note.",
            link_path=f"/app/alerts?alert={alert_id}&note={note.id}",
        )
    note.user_email = current_user.email
    return note


@router.patch("/{alert_id}/notes/{note_id}", response_model=AlertNoteResponse)
async def update_alert_note(
    alert_id: int,
    note_id: int,
    payload: AlertNoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Edit a note. Only its author may edit it."""
    await _visible_alert(alert_id, current_user, db)
    result = await db.execute(
        select(AlertNote).where(
            AlertNote.id == note_id,
            AlertNote.alert_id == alert_id,
            AlertNote.user_id == current_user.id,
        )
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Note cannot be blank")
    note.body = body
    note.edited_at = datetime.now(UTC).replace(tzinfo=None)
    await db.commit()
    await db.refresh(note)
    note.user_email = current_user.email
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
