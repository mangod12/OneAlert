"""
Alerts router for managing vulnerability notifications.
Provides endpoints for viewing, acknowledging, and getting statistics on security alerts.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.alert import Alert, AlertRead, AlertUpdate, AlertListResponse, AlertStats, AlertStatus, Severity # Import AlertRead
from backend.models.asset import Asset
from backend.routers.auth import get_active_user

router = APIRouter()


@router.get("/", response_model=AlertListResponse)
async def list_alerts(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(10, ge=1, le=100, description="Page size"),
    severity: Optional[Severity] = Query(None, description="Filter by severity"),
    status: Optional[AlertStatus] = Query(None, description="Filter by status"),
    asset_id: Optional[int] = Query(None, description="Filter by asset ID"),
    cve_id: Optional[str] = Query(None, description="Filter by CVE ID"),
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

    # Finalize count query using a subquery for explicitness and to avoid deprecation warnings
    final_count_query = select(func.count()).select_from(count_base_query.subquery())
    total = (await db.execute(final_count_query)).scalar_one()

    # Apply ordering and pagination to the main data query
    query = query.order_by(Alert.created_at.desc()).offset(skip).limit(size)
    
    result = await db.execute(query)
    rows = result.all()  # This will give rows of (Alert, asset_name, asset_vendor, asset_product)

    alerts_with_assets = []
    for row_data in rows:
        alert_instance = row_data.Alert
        alert_dict = alert_instance.to_dict() # Call to_dict() on the Alert object
        alert_dict["asset_name"] = row_data.asset_name
        alert_dict["asset_vendor"] = row_data.asset_vendor
        alert_dict["asset_product"] = row_data.asset_product
        alerts_with_assets.append(alert_dict)

    return AlertListResponse(
        alerts=alerts_with_assets,
        total=total,
        page=page,
        size=size,
        pages=(total + size - 1) // size if total > 0 else 1
    )


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
    alert.acknowledged_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(alert)
    
    return {"message": "Alert acknowledged successfully"}


@router.get("/{alert_id}/remediations")
async def get_alert_remediations(
    alert_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get remediation actions for an alert. Generates on-demand if none exist."""
    from backend.models.remediation import RemediationAction, RemediationResponse
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