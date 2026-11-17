"""
Alerts router for managing vulnerability notifications.
Provides endpoints for viewing, acknowledging, and getting statistics on security alerts.
"""


import csv
import io
from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from backend.database.db import get_async_db
from backend.models.alert import (  # Import AlertRead
    Alert,
    AlertListResponse,
    AlertRead,
    AlertStats,
    AlertStatus,
    AlertUpdate,
    Severity,
)
from backend.models.asset import Asset
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


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
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|cvss_desc|cvss_asc)$",
        description="Sort order"
    ),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """List user's alerts with pagination and filtering."""
    skip = (page - 1) * size

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
    ).where(Alert.user_id == current_user.id)

    # Build base for count query. Filters will be added to this.
    count_base_query = select(Alert.id).where(Alert.user_id == current_user.id)

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
    if assigned == "me":
        query = query.filter(Alert.assigned_to_id == current_user.id)
        count_base_query = count_base_query.filter(Alert.assigned_to_id == current_user.id)
    elif assigned == "unassigned":
        query = query.filter(Alert.assigned_to_id.is_(None))
        count_base_query = count_base_query.filter(Alert.assigned_to_id.is_(None))

    # Finalize count query using a subquery for explicitness and to avoid deprecation warnings
    final_count_query = select(func.count()).select_from(count_base_query.subquery())
    total = (await db.execute(final_count_query)).scalar_one()

    # Apply ordering and pagination to the main data query
    order_columns = {
        "created_at_desc": [Alert.created_at.desc()],
        "created_at_asc": [Alert.created_at.asc()],
        "cvss_desc": [Alert.cvss_score.desc().nulls_last(), Alert.created_at.desc()],
        "cvss_asc": [Alert.cvss_score.asc().nulls_last(), Alert.created_at.desc()],
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
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Export the filtered alert list as CSV (same filters as the list, max 5000 rows)."""
    query = select(Alert, Asset.name.label("asset_name")).join(
        Asset, Alert.asset_id == Asset.id
    ).options(
        joinedload(Alert.assignee)
    ).where(Alert.user_id == current_user.id)

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

    query = query.order_by(Alert.created_at.desc()).limit(5000)
    rows = (await db.execute(query)).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "cve_id", "title", "severity", "status", "cvss_score",
        "asset_name", "assigned_to_email", "created_at", "acknowledged_at",
    ])
    for row in rows:
        alert = row.Alert
        writer.writerow([
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
        ])
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


@router.get("/{alert_id}", response_model=AlertRead) # Use AlertRead as the response_model
async def get_alert(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get a specific alert by ID."""
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
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

    for field, value in update_data.items():
        setattr(alert, field, value)

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
            Alert.user_id == current_user.id
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(alert)

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
            Alert.user_id == current_user.id
        )
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found"
        )

    alert.status = AlertStatus.RESOLVED

    await db.commit()
    await db.refresh(alert)

    return {"message": "Alert resolved successfully"}


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
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
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
        select(Alert).where(Alert.id == alert_id, Alert.user_id == current_user.id)
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
