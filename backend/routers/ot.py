"""
OT (Operational Technology) router for industrial asset discovery and correlation.

Provides endpoints for:
- Managing network sensors (polling stations, agents, APIs)
- Viewing discovered devices from passive scanning
- Correlating discovered devices to managed assets
- OT-specific asset filtering and drilldown
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_
import json

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.discovered_device import (
    NetworkSensor, DiscoveredDevice, 
    NetworkSensorCreate, NetworkSensorUpdate, NetworkSensorResponse,
    DiscoveredDeviceCreate, DiscoveredDeviceUpdate, DiscoveredDeviceResponse, DiscoveredDeviceListResponse,
    DeviceConfidence, DiscoveryMethod
)
from backend.routers.auth import get_active_user

router = APIRouter()


# ============================================================================
# NETWORK SENSOR ENDPOINTS
# ============================================================================

@router.post("/sensors", response_model=NetworkSensorResponse, status_code=status.HTTP_201_CREATED)
async def create_network_sensor(
    sensor_data: NetworkSensorCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Register a new network monitoring sensor."""
    db_sensor = NetworkSensor(
        user_id=current_user.id,
        **sensor_data.model_dump()
    )
    db.add(db_sensor)
    await db.commit()
    await db.refresh(db_sensor)
    return db_sensor


@router.get("/sensors", response_model=List[NetworkSensorResponse])
async def list_network_sensors(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """List all network sensors for the user."""
    result = await db.execute(
        select(NetworkSensor).where(NetworkSensor.user_id == current_user.id)
        .order_by(NetworkSensor.created_at.desc())
    )
    return result.scalars().all()


@router.get("/sensors/{sensor_id}", response_model=NetworkSensorResponse)
async def get_network_sensor(
    sensor_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get details of a specific network sensor."""
    result = await db.execute(
        select(NetworkSensor).where(
            NetworkSensor.id == sensor_id,
            NetworkSensor.user_id == current_user.id
        )
    )
    sensor = result.scalar_one_or_none()
    if not sensor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    return sensor


@router.patch("/sensors/{sensor_id}", response_model=NetworkSensorResponse)
async def update_network_sensor(
    sensor_id: int,
    sensor_update: NetworkSensorUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update a network sensor configuration."""
    result = await db.execute(
        select(NetworkSensor).where(
            NetworkSensor.id == sensor_id,
            NetworkSensor.user_id == current_user.id
        )
    )
    sensor = result.scalar_one_or_none()
    if not sensor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    
    # Update only provided fields
    for field, value in sensor_update.model_dump(exclude_unset=True).items():
        setattr(sensor, field, value)
    
    await db.commit()
    await db.refresh(sensor)
    return sensor


@router.delete("/sensors/{sensor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_network_sensor(
    sensor_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Delete a network sensor."""
    result = await db.execute(
        select(NetworkSensor).where(
            NetworkSensor.id == sensor_id,
            NetworkSensor.user_id == current_user.id
        )
    )
    sensor = result.scalar_one_or_none()
    if not sensor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    
    await db.delete(sensor)
    await db.commit()


# ============================================================================
# DISCOVERED DEVICE ENDPOINTS
# ============================================================================

@router.post("/discovered-devices", response_model=DiscoveredDeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_discovered_device(
    device_data: DiscoveredDeviceCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Register a newly discovered device (from sensor or manual report)."""
    db_device = DiscoveredDevice(
        user_id=current_user.id,
        ports_open=device_data.ports_open,
        services_detected=device_data.services_detected,
        protocols=device_data.protocols,
        industrial_protocols=device_data.industrial_protocols,
        **{k: v for k, v in device_data.model_dump().items() 
           if k not in ['ports_open', 'services_detected', 'protocols', 'industrial_protocols']}
    )
    db.add(db_device)
    await db.commit()
    await db.refresh(db_device)
    return db_device


@router.get("/discovered-devices", response_model=DiscoveredDeviceListResponse)
async def list_discovered_devices(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    ip_address: Optional[str] = Query(None, description="Filter by IP address"),
    ot_only: Optional[bool] = Query(False, description="Only show OT devices"),
    risk_min: Optional[float] = Query(None, ge=0, le=100, description="Minimum risk score"),
    risk_max: Optional[float] = Query(None, ge=0, le=100, description="Maximum risk score"),
    correlated: Optional[bool] = Query(None, description="Filter by correlation status"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """List discovered devices with filtering and pagination."""
    skip = (page - 1) * size
    
    # Build query
    query = select(DiscoveredDevice).where(DiscoveredDevice.user_id == current_user.id)
    count_query = select(func.count()).select_from(DiscoveredDevice).where(DiscoveredDevice.user_id == current_user.id)
    
    # Apply filters
    if ip_address:
        query = query.filter(DiscoveredDevice.ip_address.ilike(f"%{ip_address}%"))
        count_query = count_query.filter(DiscoveredDevice.ip_address.ilike(f"%{ip_address}%"))
    
    if ot_only:
        query = query.filter(DiscoveredDevice.is_ot_device == True)
        count_query = count_query.filter(DiscoveredDevice.is_ot_device == True)
    
    if risk_min is not None:
        query = query.filter(DiscoveredDevice.risk_score >= risk_min)
        count_query = count_query.filter(DiscoveredDevice.risk_score >= risk_min)
    
    if risk_max is not None:
        query = query.filter(DiscoveredDevice.risk_score <= risk_max)
        count_query = count_query.filter(DiscoveredDevice.risk_score <= risk_max)
    
    if correlated is not None:
        query = query.filter(DiscoveredDevice.is_correlated == correlated)
        count_query = count_query.filter(DiscoveredDevice.is_correlated == correlated)
    
    # Get total
    total = (await db.execute(count_query)).scalar_one()
    
    # Apply pagination and ordering
    query = query.order_by(DiscoveredDevice.risk_score.desc(), DiscoveredDevice.last_seen.desc())
    query = query.offset(skip).limit(size)
    
    result = await db.execute(query)
    devices = result.scalars().all()
    
    return DiscoveredDeviceListResponse(
        devices=devices,
        total=total,
        page=page,
        size=size
    )


@router.get("/discovered-devices/{device_id}", response_model=DiscoveredDeviceResponse)
async def get_discovered_device(
    device_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get details of a discovered device."""
    result = await db.execute(
        select(DiscoveredDevice).where(
            DiscoveredDevice.id == device_id,
            DiscoveredDevice.user_id == current_user.id
        )
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


@router.patch("/discovered-devices/{device_id}", response_model=DiscoveredDeviceResponse)
async def update_discovered_device(
    device_id: int,
    device_update: DiscoveredDeviceUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Update enriched data for a discovered device (manual feedback)."""
    result = await db.execute(
        select(DiscoveredDevice).where(
            DiscoveredDevice.id == device_id,
            DiscoveredDevice.user_id == current_user.id
        )
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    # Update fields
    for field, value in device_update.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    
    await db.commit()
    await db.refresh(device)
    return device


@router.post("/discovered-devices/{device_id}/correlate/{asset_id}", response_model=DiscoveredDeviceResponse)
async def correlate_device_to_asset(
    device_id: int,
    asset_id: int,
    correlation_score: Optional[float] = Query(None, ge=0, le=100),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Manually correlate a discovered device to a managed asset."""
    # Verify device belongs to user
    device_result = await db.execute(
        select(DiscoveredDevice).where(
            DiscoveredDevice.id == device_id,
            DiscoveredDevice.user_id == current_user.id
        )
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    # Verify asset belongs to user
    asset_result = await db.execute(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.user_id == current_user.id
        )
    )
    asset = asset_result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    
    # Update correlation
    device.asset_id = asset_id
    device.is_correlated = True
    device.correlation_score = correlation_score or 100.0
    
    await db.commit()
    await db.refresh(device)
    return device


@router.post("/discovered-devices/{device_id}/promote-to-asset")
async def promote_device_to_asset(
    device_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Promote a discovered device to a managed asset."""
    # Get discovered device
    device_result = await db.execute(
        select(DiscoveredDevice).where(
            DiscoveredDevice.id == device_id,
            DiscoveredDevice.user_id == current_user.id
        )
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    # Create managed asset from discovered device
    new_asset = Asset(
        user_id=current_user.id,
        name=device.hostname or f"{device.manufacturer} {device.model}",
        asset_type=device.ot_device_type or "other_ot" if device.is_ot_device else "hardware",
        vendor=device.manufacturer,
        product=device.model,
        version=device.firmware_version,
        description=f"Promoted from discovered device at {device.ip_address}",
        is_ot_asset=device.is_ot_device,
        primary_protocol=device.protocols[0] if device.protocols else None,
        secondary_protocols=json.dumps(device.protocols[1:]) if device.protocols and len(device.protocols) > 1 else None,
        serial_number=device.serial_number,
        firmware_version=device.firmware_version,
        last_known_ip=device.ip_address,
        criticality="high" if device.risk_score > 70 else "medium" if device.risk_score > 40 else "low",
        discovery_method="sensor_report"
    )
    
    db.add(new_asset)
    await db.flush()
    
    # Correlate discovered device to new asset
    device.asset_id = new_asset.id
    device.is_correlated = True
    device.correlation_score = 100.0
    
    await db.commit()
    await db.refresh(new_asset)
    
    return {
        "message": "Device promoted to managed asset",
        "asset_id": new_asset.id,
        "asset_name": new_asset.name
    }


# ============================================================================
# OT-SPECIFIC DASHBOARDS / ANALYTICS
# ============================================================================

@router.get("/summary")
async def get_ot_summary(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get OT asset discovery summary for dashboard."""
    
    # Count managed OT assets
    managed_result = await db.execute(
        select(func.count(Asset.id)).where(
            Asset.user_id == current_user.id,
            Asset.is_ot_asset == True
        )
    )
    managed_ot_count = managed_result.scalar_one()
    
    # Count discovered OT devices
    discovered_result = await db.execute(
        select(func.count(DiscoveredDevice.id)).where(
            DiscoveredDevice.user_id == current_user.id,
            DiscoveredDevice.is_ot_device == True
        )
    )
    discovered_ot_count = discovered_result.scalar_one()
    
    # Count high-risk discovered devices
    high_risk_result = await db.execute(
        select(func.count(DiscoveredDevice.id)).where(
            DiscoveredDevice.user_id == current_user.id,
            DiscoveredDevice.risk_score >= 70
        )
    )
    high_risk_count = high_risk_result.scalar_one()
    
    # Count uncorrelated devices
    uncorrelated_result = await db.execute(
        select(func.count(DiscoveredDevice.id)).where(
            DiscoveredDevice.user_id == current_user.id,
            DiscoveredDevice.is_correlated == False
        )
    )
    uncorrelated_count = uncorrelated_result.scalar_one()
    
    return {
        "managed_ot_assets": managed_ot_count,
        "discovered_ot_devices": discovered_ot_count,
        "high_risk_devices": high_risk_count,
        "uncorrelated_devices": uncorrelated_count,
        "discovery_gap": discovered_ot_count - (managed_ot_count - high_risk_count)
    }


@router.get("/devices-by-zone")
async def get_devices_by_zone(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get OT devices grouped by network zone (Purdue model)."""
    result = await db.execute(
        select(Asset.network_zone, func.count(Asset.id)).where(
            Asset.user_id == current_user.id,
            Asset.is_ot_asset == True
        ).group_by(Asset.network_zone)
    )
    zones = result.all()
    return {"zones": [{"zone": z[0] or "unknown", "count": z[1]} for z in zones]}


@router.get("/devices-by-protocol")
async def get_devices_by_protocol(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Get OT devices grouped by primary communication protocol."""
    result = await db.execute(
        select(Asset.primary_protocol, func.count(Asset.id)).where(
            Asset.user_id == current_user.id,
            Asset.is_ot_asset == True,
            Asset.primary_protocol != None
        ).group_by(Asset.primary_protocol)
    )
    protocols = result.all()
    return {"protocols": [{"protocol": p[0], "count": p[1]} for p in protocols]}
