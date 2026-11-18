"""
Assets router for managing user-tracked devices and software.
Provides CRUD operations for assets that users want to monitor for vulnerabilities.
"""


import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case as sql_case
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert, AlertStatus
from backend.models.asset import Asset, AssetCreate, AssetListResponse, AssetResponse, AssetUpdate
from backend.models.user import User
from backend.routers.auth import get_active_user

router = APIRouter()


@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def create_asset(
    asset_data: AssetCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Create a new asset for the current user."""
    db_asset = Asset(
        user_id=current_user.id,
        **asset_data.model_dump()
    )

    db.add(db_asset)
    await db.commit()
    await db.refresh(db_asset)

    return db_asset


@router.get("/", response_model=AssetListResponse)
async def list_assets(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(10, ge=1, le=100, description="Page size"),
    asset_type: str | None = Query(None, description="Filter by asset type"),
    vendor: str | None = Query(None, description="Filter by vendor"),
    criticality: str | None = Query(None, description="Filter by criticality"),
    is_ot: bool | None = Query(None, description="Filter to OT assets (true) or non-OT assets (false)"),
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|name_asc|name_desc|criticality_desc|criticality_asc)$",
        description="Sort order"
    ),
    search: str | None = Query(None, description="Search in name, vendor, or product"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """List user's assets with pagination and filtering."""
    # Build query
    query = select(Asset).where(Asset.user_id == current_user.id)
    count_query = select(func.count()).select_from(Asset).where(Asset.user_id == current_user.id)  # Base count query

    # Apply filters
    if vendor:
        query = query.filter(Asset.vendor == vendor)
        count_query = count_query.filter(Asset.vendor == vendor) # Apply to count_query as well
    if criticality:
        query = query.filter(Asset.criticality == criticality)
        count_query = count_query.filter(Asset.criticality == criticality) # Apply to count_query as well
    if asset_type:
        query = query.filter(Asset.asset_type == asset_type)
        count_query = count_query.filter(Asset.asset_type == asset_type) # Apply to count_query as well
    if is_ot is not None:
        query = query.filter(Asset.is_ot_asset == is_ot)
        count_query = count_query.filter(Asset.is_ot_asset == is_ot) # Apply to count_query as well
    if search:
        search_filter = (
            Asset.name.ilike(f"%{search}%") |
            Asset.vendor.ilike(f"%{search}%") |
            Asset.product.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)  # Apply search filter to count_query as well

    # Get total count
    # Ensure count_query also has user_id filter if needed and is properly formed.
    total = (await db.execute(count_query)).scalar_one()

    # Apply pagination and ordering
    offset = (page - 1) * size
    criticality_rank = sql_case(
        {"critical": 4, "high": 3, "medium": 2, "low": 1},
        value=Asset.criticality,
        else_=2
    )
    order_columns = {
        "created_at_desc": [Asset.created_at.desc()],
        "created_at_asc": [Asset.created_at.asc()],
        "name_asc": [Asset.name.asc()],
        "name_desc": [Asset.name.desc()],
        "criticality_desc": [criticality_rank.desc(), Asset.name.asc()],
        "criticality_asc": [criticality_rank.asc(), Asset.name.asc()],
    }
    query = query.offset(offset).limit(size).order_by(*order_columns[sort])

    # Execute query
    result = await db.execute(query)
    assets = result.scalars().all()

    # Open (pending or acknowledged) alert counts per asset on this page.
    asset_ids = [asset.id for asset in assets]
    open_counts: dict[int, int] = {}
    if asset_ids:
        count_rows = await db.execute(
            select(Alert.asset_id, func.count())
            .where(
                Alert.user_id == current_user.id,
                Alert.asset_id.in_(asset_ids),
                Alert.status.in_([AlertStatus.PENDING, AlertStatus.ACKNOWLEDGED]),
            )
            .group_by(Alert.asset_id)
        )
        open_counts = {row[0]: row[1] for row in count_rows.all()}
    items = [
        AssetResponse.model_validate(asset).model_copy(
            update={"open_alert_count": open_counts.get(asset.id, 0)}
        )
        for asset in assets
    ]

    return AssetListResponse(
        assets=items,
        total=total,
        page=page,
        size=size
    )


@router.get("/export")
async def export_assets(
    asset_type: str | None = Query(None, description="Filter by asset type"),
    vendor: str | None = Query(None, description="Filter by vendor"),
    criticality: str | None = Query(None, description="Filter by criticality"),
    is_ot: bool | None = Query(None, description="Filter to OT assets (true) or non-OT assets (false)"),
    search: str | None = Query(None, description="Search in name, vendor, or product"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Export the filtered asset inventory as CSV (same filters as the list, max 5000 rows)."""
    query = select(Asset).where(Asset.user_id == current_user.id)

    if vendor:
        query = query.filter(Asset.vendor == vendor)
    if criticality:
        query = query.filter(Asset.criticality == criticality)
    if asset_type:
        query = query.filter(Asset.asset_type == asset_type)
    if is_ot is not None:
        query = query.filter(Asset.is_ot_asset == is_ot)
    if search:
        query = query.where(
            Asset.name.ilike(f"%{search}%")
            | Asset.vendor.ilike(f"%{search}%")
            | Asset.product.ilike(f"%{search}%")
        )

    query = query.order_by(Asset.created_at.desc()).limit(5000)
    rows = (await db.execute(query)).scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "name", "asset_type", "vendor", "product", "version",
        "criticality", "is_ot_asset", "network_zone", "primary_protocol",
        "serial_number", "last_known_ip", "created_at",
    ])
    for asset in rows:
        writer.writerow([
            asset.id,
            asset.name,
            asset.asset_type.value if hasattr(asset.asset_type, "value") else asset.asset_type,
            asset.vendor or "",
            asset.product or "",
            asset.version or "",
            asset.criticality or "",
            "true" if asset.is_ot_asset else "false",
            asset.network_zone or "",
            asset.primary_protocol or "",
            asset.serial_number or "",
            asset.last_known_ip or "",
            asset.created_at.isoformat() if asset.created_at else "",
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=assets.csv"},
    )


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get a specific asset by ID."""
    result = await db.execute(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == current_user.id
        )
    )
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )

    return asset


@router.put("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: int,
    asset_update: AssetUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update an existing asset."""
    result = await db.execute(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == current_user.id
        )
    )
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )

    # Update asset fields
    update_data = asset_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(asset, field, value)

    await db.commit()
    await db.refresh(asset)

    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Delete an asset."""
    result = await db.execute(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == current_user.id
        )
    )
    asset = result.scalar_one_or_none()

    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )

    await db.delete(asset)
    await db.commit()


@router.get("/types/", response_model=list[str])
async def get_asset_types():
    """Get available asset types."""
    from backend.models.asset import AssetType
    return [asset_type.value for asset_type in AssetType]


@router.get("/vendors/", response_model=list[str])
async def get_asset_vendors(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get distinct vendor names across the current user's assets."""
    result = await db.execute(
        select(Asset.vendor)
        .where(
            Asset.user_id == current_user.id,
            Asset.vendor.is_not(None),
            Asset.vendor != ""
        )
        .distinct()
        .order_by(Asset.vendor)
    )
    return [row[0] for row in result.all()]
