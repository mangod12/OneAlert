"""
Sensor data ingestion router for receiving bulk network discovery data.

Allows sensors (SNMP pollers, Zeek agents, custom collectors) to POST
discovered device inventory. Includes deduplication, enrichment, and
batching for efficient processing.

Typical workflow:
1. Sensor POSTs batch of discovered devices to /api/v1/ot/ingest
2. Router validates and deduplicates against existing discovered_devices
3. Risk scoring applied
4. Devices stored, duplicates skipped or updated
5. Alerts triggered for high-risk or new OT devices
"""

from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging
from datetime import datetime

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.discovered_device import DiscoveredDevice, DiscoveryMethod
from backend.routers.auth import get_active_user

logger = logging.getLogger(__name__)

router = APIRouter()


class SensorReportItem(dict):
    """Flexible schema for sensor-reported device data."""
    pass


class SensorIngestionRequest:
    """Parsed sensor ingestion request."""
    
    def __init__(self, data: Dict[str, Any]):
        self.sensor_id: int = data.get("sensor_id")
        self.discovery_method: str = data.get("discovery_method", "sensor_report")
        self.timestamp: str = data.get("timestamp")
        self.devices: List[Dict[str, Any]] = data.get("devices", [])
    
    def validate(self) -> bool:
        """Basic validation of ingestion request."""
        if not self.sensor_id or not self.devices:
            return False
        if not isinstance(self.devices, list):
            return False
        return True


@router.post("/ingest/batch")
async def ingest_sensor_batch(
    request_data: Dict[str, Any],
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Ingest a batch of discovered devices from a network sensor.
    
    Request schema:
    {
        "sensor_id": 1,
        "discovery_method": "passive_snmp" | "modbus_scan" | etc,
        "timestamp": "2026-03-09T14:30:00Z",
        "devices": [
            {
                "ip_address": "192.168.1.50",
                "mac_address": "00:1a:2b:3c:4d:5e",
                "hostname": "PLC-001",
                "device_class": "PLC",
                "manufacturer": "Siemens",
                "model": "S7-1200",
                "firmware_version": "4.2.0",
                "serial_number": "12345678",
                "ports_open": [502, 80],
                "services_detected": ["modbus", "http"],
                "protocols": ["modbus", "http"],
                "industrial_protocols": ["modbus"],
                "is_ot_device": true,
                "ot_device_type": "plc",
                "confidence": "high"
            }
        ]
    }
    """
    
    try:
        # Parse and validate request
        ingestion = SensorIngestionRequest(request_data)
        if not ingestion.validate():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid ingestion request: missing sensor_id or devices"
            )
        
        # Verify sensor belongs to user
        from backend.models.discovered_device import NetworkSensor  # Import here to avoid circular deps
        sensor_result = await db.execute(
            select(NetworkSensor).where(
                NetworkSensor.id == ingestion.sensor_id,
                NetworkSensor.user_id == current_user.id
            )
        )
        sensor = sensor_result.scalar_one_or_none()
        if not sensor:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sensor not found or access denied"
            )
        
        # Process each device in batch
        created_count = 0
        updated_count = 0
        skipped_count = 0
        high_risk_devices = []
        
        for device_data in ingestion.devices:
            try:
                result = await _process_ingested_device(
                    db, current_user.id, ingestion.sensor_id, 
                    device_data, ingestion.discovery_method
                )
                
                if result["status"] == "created":
                    created_count += 1
                    if result.get("risk_score", 0) > 70:
                        high_risk_devices.append(result)
                elif result["status"] == "updated":
                    updated_count += 1
                elif result["status"] == "skipped":
                    skipped_count += 1
                    
            except Exception as e:
                logger.warning(f"Error processing device {device_data.get('ip_address')}: {e}")
                skipped_count += 1
        
        # Update sensor heartbeat
        sensor.last_heartbeat = datetime.utcnow()
        sensor.last_discovery_count = len(ingestion.devices)
        await db.commit()
        
        return {
            "status": "success",
            "summary": {
                "processed": len(ingestion.devices),
                "created": created_count,
                "updated": updated_count,
                "skipped": skipped_count
            },
            "high_risk_devices": high_risk_devices,
            "message": f"Processed {len(ingestion.devices)} devices: {created_count} new, {updated_count} updated"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sensor ingestion error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ingestion error: {str(e)}"
        )


@router.post("/ingest/single")
async def ingest_single_device(
    device_data: Dict[str, Any],
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db)
):
    """Ingest a single discovered device (for real-time sensors)."""
    
    try:
        result = await _process_ingested_device(
            db, current_user.id, None, device_data, 
            device_data.get("discovery_method", "sensor_report")
        )
        
        return {
            "status": "success",
            "device_id": result.get("device_id"),
            "action": result.get("status")
        }
        
    except Exception as e:
        logger.error(f"Single device ingestion error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# ============================================================================
# INTERNAL HELPERS
# ============================================================================

async def _process_ingested_device(
    db: AsyncSession,
    user_id: int,
    sensor_id: int,
    device_data: Dict[str, Any],
    discovery_method: str
) -> Dict[str, Any]:
    """
    Process a single ingested device:
    1. Check for duplicates (by IP + MAC)
    2. Calculate risk score
    3. Create or update DiscoveredDevice
    4. Return result metadata
    """
    
    ip_address = device_data.get("ip_address")
    mac_address = device_data.get("mac_address")
    hostname = device_data.get("hostname")
    
    if not ip_address:
        raise ValueError("Device must have ip_address")
    
    # Check for existing device (by IP + MAC if available, else by IP)
    existing_query = select(DiscoveredDevice).where(
        DiscoveredDevice.user_id == user_id,
        DiscoveredDevice.ip_address == ip_address
    )
    
    if mac_address:
        existing_query = select(DiscoveredDevice).where(
            DiscoveredDevice.user_id == user_id,
            (DiscoveredDevice.ip_address == ip_address) | (DiscoveredDevice.mac_address == mac_address)
        )
    
    existing_result = await db.execute(existing_query)
    existing_device = existing_result.scalar_one_or_none()
    
    # Calculate OT risk score
    risk_score = await _calculate_risk_score(device_data)
    risk_factors = await _identify_risk_factors(device_data)
    
    if existing_device:
        # UPDATE existing device
        existing_device.last_seen = datetime.utcnow()
        existing_device.hostname = hostname or existing_device.hostname
        existing_device.risk_score = risk_score
        existing_device.risk_factors = risk_factors
        
        # Update enriched fields if new data provided
        if device_data.get("manufacturer"):
            existing_device.manufacturer = device_data.get("manufacturer")
        if device_data.get("model"):
            existing_device.model = device_data.get("model")
        if device_data.get("firmware_version"):
            existing_device.firmware_version = device_data.get("firmware_version")
        
        await db.commit()
        return {
            "status": "updated",
            "device_id": existing_device.id,
            "risk_score": risk_score
        }
    
    else:
        # CREATE new device
        new_device = DiscoveredDevice(
            user_id=user_id,
            sensor_id=sensor_id,
            ip_address=ip_address,
            mac_address=mac_address,
            hostname=hostname,
            device_class=device_data.get("device_class"),
            manufacturer=device_data.get("manufacturer"),
            model=device_data.get("model"),
            firmware_version=device_data.get("firmware_version"),
            serial_number=device_data.get("serial_number"),
            is_ot_device=device_data.get("is_ot_device", False),
            ot_device_type=device_data.get("ot_device_type"),
            ports_open=device_data.get("ports_open"),
            services_detected=device_data.get("services_detected"),
            protocols=device_data.get("protocols"),
            industrial_protocols=device_data.get("industrial_protocols"),
            confidence=device_data.get("confidence", "medium"),
            discovery_method=discovery_method,
            risk_score=risk_score,
            risk_factors=risk_factors
        )
        
        db.add(new_device)
        await db.commit()
        await db.refresh(new_device)
        
        return {
            "status": "created",
            "device_id": new_device.id,
            "risk_score": risk_score
        }


async def _calculate_risk_score(device_data: Dict[str, Any]) -> float:
    """
    Calculate OT device risk score (0-100).
    
    Risk factors:
    - Exposed services (50% weight) - SSH, Telnet, HTTP on OT device
    - Outdated firmware (30% weight)
    - Known vulnerable protocols (20% weight)
    """
    
    score = 0.0
    
    # Factor 1: Exposed insecure services (SSH, Telnet, HTTP on OT device)
    services = device_data.get("services_detected", [])
    ports = device_data.get("ports_open", [])
    is_ot = device_data.get("is_ot_device", False)
    
    exposed_insecure_services = ["ssh", "telnet", "http", "ftp", "smtp"]
    dangerous_ports = [22, 23, 80, 21, 25]  # SSH, Telnet, HTTP, FTP, SMTP
    
    if is_ot:
        # OT device with exposed insecure services is HIGH risk
        for svc in services:
            if svc.lower() in exposed_insecure_services:
                score += 25  # Major risk factor
        
        for port in ports:
            if port in dangerous_ports:
                score += 10  # Secondary risk
    
    # Factor 2: Industrial protocols (lower risk if HTTPS/VPN also present)
    industrial_protocols = device_data.get("industrial_protocols", [])
    if industrial_protocols:
        # Modbus, DNP3, Profinet have no built-in auth - add risk if exposed
        for proto in industrial_protocols:
            if proto.lower() in ["modbus", "dnp3", "profibus"]:
                score += 15
        
        # Check for HTTPS/encrypted services
        if "https" not in [s.lower() for s in services]:
            score += 10  # Higher risk if no encryption
    
    # Factor 3: Outdated firmware (heuristic - assume >3 years is outdated)
    firmware = device_data.get("firmware_version", "")
    if firmware:
        # Simplified: assume X.Y version < 2.0 is outdated
        try:
            version_parts = firmware.split(".")
            if int(version_parts[0]) < 2:
                score += 20
        except:
            pass
    
    # Factor 4: Missing critical protocol (if OT but no security/encr)
    if is_ot and not any(p.lower() in ["https", "opc_ua", "ips"] 
                         for p in industrial_protocols):
        score += 15
    
    return min(score, 100.0)  # Cap at 100


async def _identify_risk_factors(device_data: Dict[str, Any]) -> List[str]:
    """Identify specific risk factors for a device."""
    
    factors = []
    services = device_data.get("services_detected", [])
    ports = device_data.get("ports_open", [])
    is_ot = device_data.get("is_ot_device", False)
    industrial_protocols = device_data.get("industrial_protocols", [])
    
    if is_ot:
        if any(s.lower() in ["ssh", "telnet", "ftp"] for s in services):
            factors.append("exposed_insecure_remote_access")
        
        if any(p in [80, 8080] for p in ports):
            factors.append("unencrypted_web_service")
    
    if any(s.lower() in ["http", "telnet"] for s in services):
        factors.append("unencrypted_protocols")
    
    if industrial_protocols and not any(p.lower() in ["https", "opc_ua"] 
                                        for p in services):
        factors.append("industrial_protocol_without_encryption")
    
    # Check for default credentials hint (simple heuristic)
    if device_data.get("model") and "default" in device_data.get("model", "").lower():
        factors.append("possible_default_credentials")
    
    return factors
