"""
Assets router for managing user-tracked devices and software.
Provides CRUD operations for assets that users want to monitor for vulnerabilities.
"""


import csv
import hashlib
import hmac
import io
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case as sql_case
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.alert import Alert, AlertStatus
from backend.models.asset import Asset, AssetCreate, AssetListResponse, AssetResponse, AssetUpdate
from backend.models.discovered_device import DiscoveredDevice
from backend.models.sbom import SBOM
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.asset_linked_records import asset_linked_records

router = APIRouter()

_SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_CRITICALITY_MULTIPLIER = {"critical": 2.0, "high": 1.5, "medium": 1.0, "low": 0.5}
_ACTIVE_ALERT_STATUSES = [AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED]


def _severity_weight(severity) -> int:
    sev = severity.value if hasattr(severity, "value") else str(severity or "").lower()
    return _SEVERITY_WEIGHT.get(sev, 1)


def _risk_level(score: int) -> str:
    if score >= 40:
        return "critical"
    if score >= 15:
        return "high"
    if score >= 5:
        return "medium"
    if score > 0:
        return "low"
    return "none"


def _risk_score(asset: Asset, base: int) -> int:
    multiplier = _CRITICALITY_MULTIPLIER.get(str(asset.criticality or "medium").lower(), 1.0)
    return min(100, round(base * multiplier))


async def _risk_base_scores(db: AsyncSession, user_id: int, asset_ids: list[int]) -> dict[int, int]:
    """Severity-weighted sum of each asset's active alerts."""
    if not asset_ids:
        return {}
    rows = await db.execute(
        select(Alert.asset_id, Alert.severity).where(
            Alert.user_id == user_id,
            Alert.asset_id.in_(asset_ids),
            Alert.status.in_(_ACTIVE_ALERT_STATUSES),
        )
    )
    bases: dict[int, int] = {}
    for asset_id, severity in rows.all():
        bases[asset_id] = bases.get(asset_id, 0) + _severity_weight(severity)
    return bases




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


def _asset_order_columns():
    criticality_rank = sql_case(
        {"critical": 4, "high": 3, "medium": 2, "low": 1},
        value=Asset.criticality,
        else_=2
    )
    return {
        "created_at_desc": [Asset.created_at.desc()],
        "created_at_asc": [Asset.created_at.asc()],
        "name_asc": [Asset.name.asc()],
        "name_desc": [Asset.name.desc()],
        "criticality_desc": [criticality_rank.desc(), Asset.name.asc()],
        "criticality_asc": [criticality_rank.asc(), Asset.name.asc()],
    }


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
        pattern="^(created_at_desc|created_at_asc|name_asc|name_desc|criticality_desc|criticality_asc|risk_desc)$",
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
    if sort == "risk_desc":
        # Computed score: sort across the full filtered set, then paginate in Python.
        result = await db.execute(query)
        all_assets = result.scalars().all()
        all_bases = await _risk_base_scores(db, current_user.id, [a.id for a in all_assets])
        all_assets.sort(key=lambda a: (-_risk_score(a, all_bases.get(a.id, 0)), a.name.lower(), a.id))
        assets = all_assets[offset:offset + size]
    else:
        query = query.offset(offset).limit(size).order_by(*_asset_order_columns()[sort], Asset.id.asc())
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
    bases = await _risk_base_scores(db, current_user.id, asset_ids)
    items = []
    for asset in assets:
        score = _risk_score(asset, bases.get(asset.id, 0))
        items.append(
            AssetResponse.model_validate(asset).model_copy(
                update={
                    "open_alert_count": open_counts.get(asset.id, 0),
                    "risk_score": score,
                    "risk_level": _risk_level(score),
                }
            )
        )

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
    sort: str = Query(
        "created_at_desc",
        pattern="^(created_at_desc|created_at_asc|name_asc|name_desc|criticality_desc|criticality_asc|risk_desc)$",
        description="Sort order, matching the inventory view",
    ),
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

    if sort == "risk_desc":
        rows = (await db.execute(query)).scalars().all()
        bases = await _risk_base_scores(db, current_user.id, [asset.id for asset in rows])
        rows.sort(key=lambda asset: (-_risk_score(asset, bases.get(asset.id, 0)), asset.name.lower(), asset.id))
        rows = rows[:5000]
    else:
        query = query.order_by(*_asset_order_columns()[sort], Asset.id.asc()).limit(5000)
        rows = (await db.execute(query)).scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "name", "asset_type", "vendor", "product", "version",
        "criticality", "is_ot_asset", "network_zone", "primary_protocol",
        "serial_number", "last_known_ip", "created_at",
    ])
    def spreadsheet_text(value):
        # CSV quoting alone does not stop spreadsheet formula interpretation.
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    for asset in rows:
        writer.writerow([spreadsheet_text(value) for value in [
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
        ]])
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

    bases = await _risk_base_scores(db, current_user.id, [asset.id])
    score = _risk_score(asset, bases.get(asset.id, 0))
    return AssetResponse.model_validate(asset).model_copy(
        update={"risk_score": score, "risk_level": _risk_level(score)}
    )


@router.get("/{asset_id}/linked-records")
async def list_asset_linked_records(
    asset_id: int,
    kind: Literal["alerts", "sboms", "discovered_devices", "suppression_rules"] = "alerts",
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    search: Annotated[str, Query(max_length=200)] = "",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Browse current linked records; foreign references return only a combined unavailable count."""
    asset = (await db.execute(select(Asset).where(
        Asset.id == asset_id, Asset.user_id == current_user.id,
    ))).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return await asset_linked_records(db, asset, current_user.id, kind, page, size, search.strip())


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


_ASSET_REFERENCES = {"alerts": Alert, "sboms": SBOM,
                     "discovered_devices": DiscoveredDevice, "suppression_rules": AlertSuppressionRule}


def _asset_values(asset):
    return {column.key: getattr(asset, column.key) for column in Asset.__table__.columns}


def _removal_fingerprint(asset, dependencies):
    return hashlib.sha256(json.dumps({"asset": _asset_values(asset), "dependencies": dependencies},
                                     sort_keys=True, default=str).encode()).hexdigest()


async def _asset_removal_state(db, asset):
    dependencies = {}
    for key, model in _ASSET_REFERENCES.items():
        dependencies[key] = (await db.execute(select(func.count()).select_from(model)
                                              .where(model.asset_id == asset.id))).scalar_one()
    return {"asset_id": asset.id, "name": asset.name, "asset_type": asset.asset_type,
            "criticality": asset.criticality, "is_ot_asset": asset.is_ot_asset,
            "dependencies": dependencies, "can_delete": not any(dependencies.values()),
            "reviewed_fingerprint": _removal_fingerprint(asset, dependencies)}


@router.get("/{asset_id}/removal-review")
async def review_asset_removal(
    asset_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Read deletion blockers without exposing or changing the linked records."""
    asset = (await db.execute(select(Asset).where(
        Asset.id == asset_id, Asset.user_id == current_user.id,
    ))).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return await _asset_removal_state(db, asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    reviewed_fingerprint: str | None = Query(None, min_length=64, max_length=64, pattern="^[a-f0-9]{64}$"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Remove only unreferenced inventory rows, never orphan operational evidence."""
    asset = (await db.execute(select(Asset).where(
        Asset.id == asset_id, Asset.user_id == current_user.id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    review = await _asset_removal_state(db, asset)
    if reviewed_fingerprint is not None and not hmac.compare_digest(
        reviewed_fingerprint, review["reviewed_fingerprint"]
    ):
        raise HTTPException(status_code=409, detail="Asset or linked records changed. Reload the removal review.")
    if not review["can_delete"]:
        raise HTTPException(status_code=409,
                            detail="Asset still has linked records. Resolve the removal blockers first.")
    conditions = [Asset.id == asset_id, Asset.user_id == current_user.id]
    conditions.extend(~select(model.id).where(model.asset_id == asset_id).exists()
                      for model in _ASSET_REFERENCES.values())
    if reviewed_fingerprint is not None:
        conditions.extend(getattr(Asset, key).is_(None) if value is None else getattr(Asset, key) == value
                          for key, value in _asset_values(asset).items() if key not in {"created_at", "updated_at"})
    try:
        result = await db.execute(sql_delete(Asset).where(*conditions).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Asset or linked records changed. Reload the removal review.")
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Asset has linked records. Reload the removal review.") from None


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
