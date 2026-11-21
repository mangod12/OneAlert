"""
Alerts router for managing vulnerability notifications.
Provides endpoints for viewing, acknowledging, and getting statistics on security alerts.
"""


import csv
import io
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from backend.database.db import get_async_db
from backend.models.alert import (
    # Import AlertRead
    Alert,
    AlertListResponse,
    AlertRead,
    AlertSnoozeRequest,
    AlertStats,
    AlertStatus,
    AlertUpdate,
    AlertWatcher,
    AlertWatcherAdd,
    AlertWatcherResponse,
    AutoAssignRequest,
    Severity,
)
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.notification import Notification
from backend.models.user import User
from backend.routers.alert_investigation import router as investigation_router
from backend.routers.auth import get_active_user
from backend.services.assignment import _open_work_loads, org_members
from backend.services.audit import add_audit_log
from backend.services.csv_export import spreadsheet_safe_row
from backend.services.investigation_notify import notify_investigation_event


def _visible_alerts(alert_id: int, current_user: User):
    """Alerts the user may open: their own, assigned to them, or watched by them."""
    watched = select(AlertWatcher.alert_id).where(AlertWatcher.user_id == current_user.id)
    return select(Alert).where(
        Alert.id == alert_id,
        or_(
            Alert.user_id == current_user.id,
            Alert.assigned_to_id == current_user.id,
            Alert.id.in_(watched),
        ),
    )


async def _fan_out_alert_update(
    db: AsyncSession, alert: Alert, actor: User, change: str
) -> list[int]:
    """Queue in-app update notifications for the alert's watchers (never the actor)."""
    watcher_ids = (await db.execute(
        select(AlertWatcher.user_id).where(AlertWatcher.alert_id == alert.id)
    )).scalars().all()
    recipient_ids = [uid for uid in watcher_ids if uid != actor.id]
    for uid in recipient_ids:
        db.add(Notification(
            user_id=uid,
            kind="alert_updated",
            title=f"Alert #{alert.id} updated",
            body=f"{change} - {alert.title}",
            link=f"/app/alerts?alert={alert.id}",
        ))
    return recipient_ids


async def _email_alert_update(
    db: AsyncSession, alert: Alert, actor: User, recipient_ids: list[int], change: str
) -> None:
    """Deliver the same update through email/Slack/webhooks per recipient preferences."""
    for uid in recipient_ids:
        recipient = (await db.execute(
            select(User).where(User.id == uid)
        )).scalar_one_or_none()
        if recipient is not None:
            await notify_investigation_event(
                recipient,
                kind="alert_updated",
                severity=alert.severity,
                title=f"Alert #{alert.id} updated",
                body=f"{actor.email} changed an alert you follow ({change}): {alert.title}.",
                link_path=f"/app/alerts?alert={alert.id}",
            )



router = APIRouter()
router.include_router(investigation_router)


@router.get("/", response_model=AlertListResponse)
async def list_alerts(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(10, ge=1, le=100, description="Page size"),
    severity: Severity | None = Query(None, description="Filter by severity"),
    status: AlertStatus | None = Query(None, description="Filter by status"),
    asset_id: int | None = Query(None, description="Filter by asset ID"),
    cve_id: str | None = Query(None, description="Filter by CVE ID"),
    search: str | None = Query(None, description="Case-insensitive substring match against CVE ID or title"),
    assigned: str | None = Query(
        None, pattern="^(me|unassigned)$", description="Filter by assignment: 'me' or 'unassigned'"
    ),
    watching: str | None = Query(
        None, pattern="^(me)$", description="'me' lists only alerts the user watches"
    ),
    snoozed: str = Query(
        "active", pattern="^(active|all|only)$",
        description="Snooze visibility: 'active' hides snoozed alerts, 'all' includes them, 'only' returns snoozed"
    ),
    min_age_days: int | None = Query(None, ge=0, le=365, description="Only alerts at least this many days old"),
    max_age_days: int | None = Query(None, ge=0, le=365, description="Only alerts at most this many days old"),
    overdue: bool | None = Query(None, description="Only unresolved alerts past their triage due date"),
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|cvss_desc|cvss_asc|severity_desc|severity_asc)$",
        description="Sort order"
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """List user's alerts with pagination and filtering."""
    skip = (page - 1) * size

    if watching == "me":
        # "Watched by me" spans the org: any alert the user follows as a watcher.
        base_filter = Alert.id.in_(
            select(AlertWatcher.alert_id).where(AlertWatcher.user_id == current_user.id)
        )
    elif assigned == "me":
        # "Assigned to me" spans the org, not just alerts the caller owns.
        base_filter = Alert.assigned_to_id == current_user.id
    else:
        base_filter = Alert.user_id == current_user.id

    # Build base query for fetching alert data and related asset info
    query = select(
        Alert,
        Asset.name.label("asset_name"),
        Asset.vendor.label("asset_vendor"),
        Asset.product.label("asset_product")
    ).join(
        Asset, Alert.asset_id == Asset.id
    ).options(
        joinedload(Alert.assignee)
    ).where(base_filter)

    # Build base for count query. Filters will be added to this.
    count_base_query = select(Alert.id).where(base_filter)

    # Apply filters to both the main query and the count base query
    if status:
        query = query.filter(Alert.status == status)
        count_base_query = count_base_query.filter(Alert.status == status)
    if severity:
        query = query.filter(Alert.severity == severity)
        count_base_query = count_base_query.filter(Alert.severity == severity)
    if asset_id:
        query = query.filter(Alert.asset_id == asset_id)
        count_base_query = count_base_query.filter(Alert.asset_id == asset_id)
    if cve_id:
        query = query.filter(Alert.cve_id == cve_id)
        count_base_query = count_base_query.filter(Alert.cve_id == cve_id)
    if search:
        search_match = or_(
            Alert.cve_id.ilike(f"%{search}%"),
            Alert.title.ilike(f"%{search}%"),
        )
        query = query.filter(search_match)
        count_base_query = count_base_query.filter(search_match)
    if assigned == "unassigned":
        query = query.filter(Alert.assigned_to_id.is_(None))
        count_base_query = count_base_query.filter(Alert.assigned_to_id.is_(None))
    if snoozed == "active":
        not_snoozed = or_(Alert.snoozed_until.is_(None), Alert.snoozed_until <= datetime.now(UTC))
        query = query.filter(not_snoozed)
        count_base_query = count_base_query.filter(not_snoozed)
    elif snoozed == "only":
        query = query.filter(Alert.snoozed_until > datetime.now(UTC))
        count_base_query = count_base_query.filter(Alert.snoozed_until > datetime.now(UTC))
    if max_age_days is not None:
        newest = datetime.now(UTC) - timedelta(days=max_age_days)
        query = query.filter(Alert.created_at >= newest)
        count_base_query = count_base_query.filter(Alert.created_at >= newest)
    if min_age_days is not None:
        oldest = datetime.now(UTC) - timedelta(days=min_age_days)
        query = query.filter(Alert.created_at <= oldest)
        count_base_query = count_base_query.filter(Alert.created_at <= oldest)
    if overdue:
        today = datetime.now(UTC).date()
        active_statuses = (AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED)
        query = query.filter(Alert.due_date.isnot(None), Alert.due_date < today, Alert.status.in_(active_statuses))
        count_base_query = count_base_query.filter(
            Alert.due_date.isnot(None), Alert.due_date < today, Alert.status.in_(active_statuses)
        )

    # Finalize count query using a subquery for explicitness and to avoid deprecation warnings
    final_count_query = select(func.count()).select_from(count_base_query.subquery())
    total = (await db.execute(final_count_query)).scalar_one()

    # Apply ordering and pagination to the main data query
    severity_rank = case(
        (func.lower(Alert.severity) == "critical", 4),
        (func.lower(Alert.severity) == "high", 3),
        (func.lower(Alert.severity) == "medium", 2),
        (func.lower(Alert.severity) == "low", 1),
        else_=0,
    )
    order_columns = {
        "created_at_desc": [Alert.created_at.desc()],
        "created_at_asc": [Alert.created_at.asc()],
        "cvss_desc": [Alert.cvss_score.desc().nulls_last(), Alert.created_at.desc()],
        "cvss_asc": [Alert.cvss_score.asc().nulls_last(), Alert.created_at.desc()],
        "severity_desc": [severity_rank.desc(), Alert.created_at.desc()],
        "severity_asc": [severity_rank.asc(), Alert.created_at.desc()],
    }
    query = query.order_by(*order_columns[sort]).offset(skip).limit(size)

    result = await db.execute(query)
    rows = result.all()  # This will give rows of (Alert, asset_name, asset_vendor, asset_product)

    alerts_with_assets = []
    for row_data in rows:
        alert_instance = row_data.Alert
        alert_dict = alert_instance.to_dict() # Call to_dict() on the Alert object
        alert_dict["asset_name"] = row_data.asset_name
        alert_dict["asset_vendor"] = row_data.asset_vendor
        alert_dict["asset_product"] = row_data.asset_product
        alert_dict["assigned_to_email"] = alert_instance.assignee.email if alert_instance.assignee else None
        alerts_with_assets.append(alert_dict)

    return AlertListResponse(
        alerts=alerts_with_assets,
        total=total,
        page=page,
        size=size,
        pages=(total + size - 1) // size if total > 0 else 1
    )


@router.get("/export")
async def export_alerts(
    severity: Severity | None = Query(None, description="Filter by severity"),
    status: AlertStatus | None = Query(None, description="Filter by status"),
    asset_id: int | None = Query(None, description="Filter by asset ID"),
    cve_id: str | None = Query(None, description="Filter by CVE ID"),
    search: str | None = Query(None, description="Case-insensitive substring match against CVE ID or title"),
    assigned: str | None = Query(
        None, pattern="^(me|unassigned)$", description="Filter by assignment: 'me' or 'unassigned'"
    ),
    watching: str | None = Query(
        None, pattern="^(me)$", description="'me' exports only alerts the user watches"
    ),
    snoozed: str = Query(
        "active", pattern="^(active|all|only)$",
        description="Snooze visibility: 'active' hides snoozed alerts, 'all' includes them, 'only' returns snoozed"
    ),
    min_age_days: int | None = Query(None, ge=0, le=365, description="Only alerts at least this many days old"),
    max_age_days: int | None = Query(None, ge=0, le=365, description="Only alerts at most this many days old"),
    overdue: bool | None = Query(None, description="Only unresolved alerts past their triage due date"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Export the filtered alert list as CSV (same filters as the list, up to 5000 rows, never silently truncated)."""
    if watching == "me":
        # "Watched by me" spans the org: any alert the user follows as a watcher.
        export_base = Alert.id.in_(
            select(AlertWatcher.alert_id).where(AlertWatcher.user_id == current_user.id)
        )
    else:
        export_base = Alert.user_id == current_user.id
    query = select(Alert, Asset.name.label("asset_name")).join(
        Asset, Alert.asset_id == Asset.id
    ).options(
        joinedload(Alert.assignee)
    ).where(export_base)

    if status:
        query = query.filter(Alert.status == status)
    if severity:
        query = query.filter(Alert.severity == severity)
    if asset_id:
        query = query.filter(Alert.asset_id == asset_id)
    if cve_id:
        query = query.filter(Alert.cve_id == cve_id)
    if search:
        query = query.filter(or_(
            Alert.cve_id.ilike(f"%{search}%"),
            Alert.title.ilike(f"%{search}%"),
        ))
    if assigned == "me":
        query = query.filter(Alert.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Alert.assigned_to_id.is_(None))
    if snoozed == "active":
        query = query.filter(or_(Alert.snoozed_until.is_(None), Alert.snoozed_until <= datetime.now(UTC)))
    elif snoozed == "only":
        query = query.filter(Alert.snoozed_until > datetime.now(UTC))
    if max_age_days is not None:
        query = query.filter(Alert.created_at >= datetime.now(UTC) - timedelta(days=max_age_days))
    if min_age_days is not None:
        query = query.filter(Alert.created_at <= datetime.now(UTC) - timedelta(days=min_age_days))
    if overdue:
        today = datetime.now(UTC).date()
        active_statuses = (AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED)
        query = query.filter(Alert.due_date.isnot(None), Alert.due_date < today, Alert.status.in_(active_statuses))

    query = query.order_by(Alert.created_at.desc(), Alert.id.desc()).limit(5001)
    rows = (await db.execute(query)).all()
    if len(rows) > 5000:
        raise HTTPException(status_code=422, detail=(
            "The filtered alerts export exceeds 5,000 records. Narrow the applied filters and retry. "
            "No partial CSV was created."))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "cve_id", "title", "severity", "status", "cvss_score",
        "asset_name", "assigned_to_email", "created_at", "acknowledged_at", "snoozed_until",
    ])
    for row in rows:
        alert = row.Alert
        writer.writerow(spreadsheet_safe_row([
            alert.id,
            alert.cve_id or "",
            alert.title,
            alert.severity.value if hasattr(alert.severity, "value") else alert.severity,
            alert.status.value if hasattr(alert.status, "value") else alert.status,
            alert.cvss_score if alert.cvss_score is not None else "",
            row.asset_name,
            alert.assignee.email if alert.assignee else "",
            alert.created_at.isoformat() if alert.created_at else "",
            alert.acknowledged_at.isoformat() if alert.acknowledged_at else "",
            alert.snoozed_until.isoformat() if alert.snoozed_until else "",
        ]))
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=alerts.csv"},
    )


@router.get("/epss-batch")
async def get_epss_batch(
    cve_ids: str = Query(..., description="Comma-separated CVE IDs (max 100, deduplicated)"),
    current_user: User = Depends(get_active_user),
):
    """Batch EPSS exploit-probability lookup for alert triage views.

    EPSS data is public (FIRST.org); no alert records are exposed here.
    """
    from backend.services.epss_service import get_epss_scores

    ids: list[str] = []
    seen: set[str] = set()
    for raw in cve_ids.split(","):
        cve = raw.strip()
        if cve and cve not in seen:
            seen.add(cve)
            ids.append(cve)
    if not ids:
        raise HTTPException(status_code=422, detail="No CVE IDs provided")
    if len(ids) > 100:
        raise HTTPException(status_code=422, detail="At most 100 CVE IDs per request")

    scores = await get_epss_scores(ids)
    return {"scores": scores}


@router.get("/kev-batch")
async def get_kev_batch(
    cve_ids: str = Query(..., description="Comma-separated CVE IDs (max 100, deduplicated)"),
    current_user: User = Depends(get_active_user),
):
    """Batch CISA KEV catalog lookup for alert triage views.

    KEV data is public (CISA); no alert records are exposed here.
    """
    from backend.services.kev_service import get_kev_entries

    ids: list[str] = []
    seen: set[str] = set()
    for raw in cve_ids.split(","):
        cve = raw.strip()
        if cve and cve not in seen:
            seen.add(cve)
            ids.append(cve)
    if not ids:
        raise HTTPException(status_code=422, detail="No CVE IDs provided")
    if len(ids) > 100:
        raise HTTPException(status_code=422, detail="At most 100 CVE IDs per request")

    entries = await get_kev_entries(ids)
    return {"entries": entries}


@router.post("/auto-assign")
async def auto_assign_alerts(
    payload: AutoAssignRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Spread the given open alerts across the org's active members,
    least-loaded first. Explicit action: no opt-in required. Resolved
    alerts and alerts owned by someone else are ignored."""
    ids = payload.alert_ids[:500]
    if not ids:
        return {"assigned": {}}
    alerts = (await db.execute(
        select(Alert).where(
            Alert.id.in_(ids),
            Alert.user_id == current_user.id,
            Alert.status.in_(("pending", "sent", "acknowledged")),
        )
    )).scalars().all()
    if not alerts:
        return {"assigned": {}}
    members = await org_members(db, current_user)
    load = await _open_work_loads(db, [m.id for m in members])
    assigned: dict[int, int] = {}
    for alert in sorted(alerts, key=lambda a: a.id):
        best = min(members, key=lambda m: (load.get(m.id, 0), m.id))
        alert.assigned_to_id = best.id
        load[best.id] = load.get(best.id, 0) + 1
        assigned[alert.id] = best.id
        if best.id != current_user.id:
            db.add(Notification(
                user_id=best.id,
                kind="alert_assigned",
                title=f"Alert #{alert.id} assigned to you",
                body=alert.title,
                link="/app/alerts",
            ))
        add_audit_log(
            db,
            user_id=current_user.id,
            action="alert_updated",
            target_type="alert",
            target_id=alert.id,
            detail=f"assigned_to_id: None -> {best.id} (auto-assign)",
        )
    await db.commit()
    return {"assigned": assigned}


@router.get("/{alert_id}", response_model=AlertRead) # Use AlertRead as the response_model
async def get_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get a specific alert by ID."""
    result = await db.execute(
        _visible_alerts(alert_id, current_user)
        .options(selectinload(Alert.asset)) # Eager load asset details
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    # Prepare response, potentially transforming alert object if needed
    # For now, assuming the Alert model can be directly returned
    # If Alert model has a to_dict or Pydantic model conversion, use it here
    return alert


@router.patch("/{alert_id}")
async def update_alert(
    alert_id: int,
    alert_update: AlertUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update an alert (mainly for acknowledging)."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            Alert.user_id == current_user.id
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    # Update alert fields
    update_data = alert_update.model_dump(exclude_unset=True)

    # Assignment changes validate the assignee is an active member of the same org
    if "assigned_to_id" in update_data:
        assignee_id = update_data["assigned_to_id"]
        if assignee_id is not None:
            assignee = (await db.execute(
                select(User).where(User.id == assignee_id, User.is_active == True)  # noqa: E712
            )).scalar_one_or_none()
            wrong_org = (
                current_user.org_id is not None
                and assignee is not None
                and assignee.org_id != current_user.org_id
            )
            no_org = current_user.org_id is None and assignee_id != current_user.id
            if assignee is None or wrong_org or no_org:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Assignee must be an active member of your organization"
                )
        if (
            assignee_id is not None
            and assignee_id != current_user.id
            and assignee_id != alert.assigned_to_id
        ):
            db.add(Notification(
                user_id=assignee_id,
                kind="alert_assigned",
                title=f"Alert #{alert.id} assigned to you",
                body=alert.title,
                link="/app/alerts",
            ))

    changes = []
    old_due_date = alert.due_date
    for field, value in update_data.items():
        old_value = getattr(alert, field)
        if old_value != value:
            changes.append(f"{field}: {old_value} -> {value}")
        setattr(alert, field, value)

    # Moving or clearing the triage target re-arms SLA notifications.
    if "due_date" in update_data and alert.due_date != old_due_date:
        alert.sla_breach_notified_at = None
        alert.sla_due_soon_notified_at = None

    if changes:
        add_audit_log(
            db,
            user_id=current_user.id,
            action="alert_updated",
            target_type="alert",
            target_id=alert.id,
            detail="; ".join(changes)[:500],
        )

    await db.commit()
    await db.refresh(alert)

    return alert


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Acknowledge an alert."""
    from datetime import datetime

    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id)
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    old_status = alert.status
    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = datetime.now(UTC)
    alert.snoozed_until = None

    change = f"status {old_status} -> {AlertStatus.ACKNOWLEDGED}"
    notified = await _fan_out_alert_update(db, alert, current_user, change)
    await db.commit()
    await db.refresh(alert)
    await _email_alert_update(db, alert, current_user, notified, change)

    return {"message": "Alert acknowledged successfully"}


@router.post("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Mark an alert as resolved."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id)
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    old_status = alert.status
    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = datetime.now(UTC)
    alert.snoozed_until = None

    change = f"status {old_status} -> {AlertStatus.RESOLVED}"
    notified = await _fan_out_alert_update(db, alert, current_user, change)
    await db.commit()
    await db.refresh(alert)
    await _email_alert_update(db, alert, current_user, notified, change)

    return {"message": "Alert resolved successfully"}


@router.post("/{alert_id}/reopen")
async def reopen_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Reopen a resolved or acknowledged alert, returning it to pending."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id)
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    old_status = alert.status
    alert.status = AlertStatus.PENDING
    alert.resolved_at = None

    change = f"status {old_status} -> {AlertStatus.PENDING}"
    notified = await _fan_out_alert_update(db, alert, current_user, change)
    await db.commit()
    await db.refresh(alert)
    await _email_alert_update(db, alert, current_user, notified, change)

    return {"message": "Alert reopened successfully"}


@router.post("/{alert_id}/snooze")
async def snooze_alert(
    alert_id: int,
    payload: AlertSnoozeRequest,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Snooze an alert for a number of hours, hiding it from the default list until then."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id)
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    alert.snoozed_until = datetime.now(UTC) + timedelta(hours=payload.hours)

    await db.commit()
    await db.refresh(alert)

    return {"message": "Alert snoozed successfully", "snoozed_until": alert.snoozed_until.isoformat()}


@router.delete("/{alert_id}/snooze")
async def unsnooze_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Clear an alert snooze, returning it to the default list."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id)
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    alert.snoozed_until = None

    await db.commit()

    return {"message": "Snooze cleared successfully"}


async def _get_watch_target(db: AsyncSession, alert_id: int, current_user: User) -> Alert:
    """Fetch an alert the user can at least read, or 404."""
    alert = (await db.execute(
        _visible_alerts(alert_id, current_user)
    )).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/{alert_id}/watchers", response_model=list[AlertWatcherResponse])
async def list_alert_watchers(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the members watching an alert."""
    alert = await _get_watch_target(db, alert_id, current_user)
    rows = (await db.execute(
        select(AlertWatcher, User)
        .join(User, User.id == AlertWatcher.user_id)
        .where(AlertWatcher.alert_id == alert.id)
    )).all()
    return [
        AlertWatcherResponse(user_id=watcher.user_id, email=user.email, full_name=user.full_name)
        for watcher, user in rows
    ]


@router.post("/{alert_id}/watch")
async def watch_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Watch an alert you can see. Idempotent."""
    alert = await _get_watch_target(db, alert_id, current_user)
    existing = (await db.execute(
        select(AlertWatcher).where(
            AlertWatcher.alert_id == alert.id, AlertWatcher.user_id == current_user.id
        )
    )).scalar_one_or_none()
    if existing is None:
        db.add(AlertWatcher(alert_id=alert.id, user_id=current_user.id))
        await db.commit()
    return {"success": True, "watching": True}


@router.delete("/{alert_id}/watch")
async def unwatch_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Stop watching an alert. Idempotent."""
    alert = await _get_watch_target(db, alert_id, current_user)
    existing = (await db.execute(
        select(AlertWatcher).where(
            AlertWatcher.alert_id == alert.id, AlertWatcher.user_id == current_user.id
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    return {"success": True, "watching": False}


@router.post("/{alert_id}/watchers", response_model=list[AlertWatcherResponse])
async def add_alert_watcher(
    alert_id: int,
    payload: AlertWatcherAdd,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Add an organization member as a watcher (owner only). Idempotent."""
    alert = (await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
    )).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if payload.user_id != current_user.id:
        member = (await db.execute(
            select(User).where(User.id == payload.user_id, User.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        wrong_org = (
            current_user.org_id is not None
            and member is not None
            and member.org_id != current_user.org_id
        )
        no_org = current_user.org_id is None and payload.user_id != current_user.id
        if member is None or wrong_org or no_org:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Watcher must be an active member of your organization"
            )

    existing = (await db.execute(
        select(AlertWatcher).where(
            AlertWatcher.alert_id == alert.id, AlertWatcher.user_id == payload.user_id
        )
    )).scalar_one_or_none()
    if existing is None:
        db.add(AlertWatcher(alert_id=alert.id, user_id=payload.user_id))
        if payload.user_id != current_user.id:
            db.add(Notification(
                user_id=payload.user_id,
                kind="alert_watching",
                title=f"You are now watching alert #{alert.id}",
                body=alert.title,
                link=f"/app/alerts?alert={alert.id}",
            ))
        await db.commit()

    rows = (await db.execute(
        select(AlertWatcher, User)
        .join(User, User.id == AlertWatcher.user_id)
        .where(AlertWatcher.alert_id == alert.id)
    )).all()
    return [
        AlertWatcherResponse(user_id=watcher.user_id, email=user.email, full_name=user.full_name)
        for watcher, user in rows
    ]


@router.delete("/{alert_id}/watchers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_alert_watcher(
    alert_id: int,
    user_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove a watcher: the owner can remove anyone, members remove themselves."""
    alert = (await db.execute(
        _visible_alerts(alert_id, current_user)
    )).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if current_user.id != alert.user_id and user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the alert owner can remove other watchers",
        )
    existing = (await db.execute(
        select(AlertWatcher).where(
            AlertWatcher.alert_id == alert.id, AlertWatcher.user_id == user_id
        )
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()


@router.get("/{alert_id}/cases")
async def list_alert_cases(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List the investigation cases that include this alert, newest first."""
    alert = await db.execute(
        select(Alert.id).where(
            Alert.id == alert_id,
            or_(Alert.user_id == current_user.id, Alert.assigned_to_id == current_user.id),
        )
    )
    if alert.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    result = await db.execute(
        select(Case)
        .join(CaseAlert, CaseAlert.case_id == Case.id)
        .where(CaseAlert.alert_id == alert_id, Case.user_id == current_user.id)
        .order_by(Case.created_at.desc(), Case.id.desc())
    )
    return [
        {
            "id": c.id,
            "title": c.title,
            "status": c.status,
            "severity": c.severity,
            "created_at": c.created_at,
        }
        for c in result.scalars().all()
    ]


@router.get("/{alert_id}/remediations")
async def get_alert_remediations(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get remediation actions for an alert. Generates on-demand if none exist."""
    from backend.models.remediation import RemediationAction
    from backend.services.remediation_engine import generate_remediations

    # Get alert
    result = await db.execute(
        _visible_alerts(alert_id, current_user)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Check for existing remediations
    existing = await db.execute(
        select(RemediationAction).where(RemediationAction.alert_id == alert_id)
    )
    actions = existing.scalars().all()

    # Generate if none exist
    if not actions:
        # Get the asset
        asset_result = await db.execute(select(Asset).where(Asset.id == alert.asset_id))
        asset = asset_result.scalar_one_or_none()

        remediation_data = generate_remediations(alert, asset)
        actions = []
        for data in remediation_data:
            action = RemediationAction(alert_id=alert_id, **data)
            db.add(action)
            actions.append(action)
        await db.commit()
        for action in actions:
            await db.refresh(action)

    return actions


@router.get("/{alert_id}/epss")
async def get_alert_epss(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get EPSS exploit probability score for an alert's CVE."""
    from backend.services.epss_service import get_epss_score

    result = await db.execute(
        _visible_alerts(alert_id, current_user)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if not alert.cve_id:
        return {"epss_score": None, "epss_percentile": None, "message": "No CVE ID associated"}

    epss = await get_epss_score(alert.cve_id)
    if not epss:
        return {"epss_score": None, "epss_percentile": None, "message": "EPSS data not available"}

    return {
        "cve_id": alert.cve_id,
        "epss_score": epss["score"],
        "epss_percentile": epss["percentile"],
    }


@router.get("/stats/timeline")
async def get_alert_timeline(
    days: int = Query(14, ge=1, le=90),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Per-day alert counts by severity over the trailing `days`-day window."""
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)
    # naive UTC, matching stored timestamps
    start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC).replace(tzinfo=None)

    result = await db.execute(
        select(Alert.severity, Alert.created_at).where(
            and_(
                Alert.user_id == current_user.id,
                Alert.created_at >= start_dt,
            )
        )
    )

    counts: dict[str, dict[str, int]] = {}
    for severity, created_at in result.all():
        if created_at is None:
            continue
        day_key = created_at.date().isoformat()
        bucket = counts.setdefault(
            day_key, {"critical": 0, "high": 0, "medium": 0, "low": 0}
        )
        sev = severity.value if isinstance(severity, Severity) else str(severity)
        if sev in bucket:
            bucket[sev] += 1

    timeline = []
    for i in range(days):
        day = start + timedelta(days=i)
        bucket = counts.get(day.isoformat(), {})
        timeline.append({
            "date": day.isoformat(),
            "critical": bucket.get("critical", 0),
            "high": bucket.get("high", 0),
            "medium": bucket.get("medium", 0),
            "low": bucket.get("low", 0),
        })

    return {"success": True, "days": timeline}


@router.get("/stats/response-metrics")
async def get_response_metrics(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Mean time to acknowledge and resolve over the trailing `days`-day window."""
    # naive UTC, matching stored timestamps
    start = (datetime.now(UTC) - timedelta(days=days)).replace(tzinfo=None)

    ack_result = await db.execute(
        select(Alert.created_at, Alert.acknowledged_at).where(
            and_(
                Alert.user_id == current_user.id,
                Alert.acknowledged_at.is_not(None),
                Alert.acknowledged_at >= start,
            )
        )
    )
    ack_rows = ack_result.all()

    res_result = await db.execute(
        select(Alert.created_at, Alert.resolved_at).where(
            and_(
                Alert.user_id == current_user.id,
                Alert.resolved_at.is_not(None),
                Alert.resolved_at >= start,
            )
        )
    )
    res_rows = res_result.all()

    def _mean_delta_seconds(rows: list) -> float | None:
        deltas = []
        for created_at, ended_at in rows:
            if created_at is None or ended_at is None:
                continue
            start_dt = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
            end_dt = ended_at.replace(tzinfo=None) if ended_at.tzinfo else ended_at
            delta = (end_dt - start_dt).total_seconds()
            if delta >= 0:
                deltas.append(delta)
        if not deltas:
            return None
        return sum(deltas) / len(deltas)

    return {
        "success": True,
        "days": days,
        "acknowledged_count": len(ack_rows),
        "resolved_count": len(res_rows),
        "mtta_seconds": _mean_delta_seconds(ack_rows),
        "mttr_seconds": _mean_delta_seconds(res_rows),
    }


@router.get("/stats/overview", response_model=AlertStats)
async def get_alert_stats(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get alert statistics for the current user."""
    # Total alerts
    total_result = await db.execute(
        select(func.count()).where(Alert.user_id == current_user.id)
    )
    total_alerts = total_result.scalar()

    # Alerts by severity
    severity_stats = {}
    for severity in Severity:
        result = await db.execute(
            select(func.count()).where(
                and_(Alert.user_id == current_user.id, Alert.severity == severity)
            )
        )
        severity_stats[f"{severity.value}_alerts"] = result.scalar()

    # Alerts by status
    pending_result = await db.execute(
        select(func.count()).where(
            and_(Alert.user_id == current_user.id, Alert.status == AlertStatus.PENDING)
        )
    )
    pending_alerts = pending_result.scalar()

    acknowledged_result = await db.execute(
        select(func.count()).where(
            and_(Alert.user_id == current_user.id, Alert.status == AlertStatus.ACKNOWLEDGED)
        )
    )
    acknowledged_alerts = acknowledged_result.scalar()

    return AlertStats(
        total_alerts=total_alerts,
        critical_alerts=severity_stats.get("critical_alerts", 0),
        high_alerts=severity_stats.get("high_alerts", 0),
        medium_alerts=severity_stats.get("medium_alerts", 0),
        low_alerts=severity_stats.get("low_alerts", 0),
        pending_alerts=pending_alerts,
        acknowledged_alerts=acknowledged_alerts
    )
