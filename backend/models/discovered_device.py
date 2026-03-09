"""
Discovered Device and Network Sensor models for industrial asset discovery.

This module defines models for:
- DiscoveredDevice: devices detected via passive network scanning or sensor input
- NetworkSensor: source sensors that report discovered devices
- DeviceFingerprint: behavioral/characteristic signatures of discovered devices

Discovery workflow:
1. NetworkSensor ingests network traffic/SNMP/Shodan/etc
2. DiscoveredDevice created with fingerprint data
3. User manually promotes to Asset or auto-correlates via fuzzy matching
4. ICS advisories checked against both discovered + managed assets
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, Float, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class DiscoveryMethod(str, Enum):
    """Methods used to discover devices."""
    PASSIVE_SNMP = "passive_snmp"
    PASSIVE_NETWORK_SCAN = "passive_network_scan"
    MODBUS_SCAN = "modbus_scan"
    PROFINET_SCAN = "profinet_scan"
    DNETTCP_SCAN = "dnettcp_scan"  # DNP3/TCP
    SHODAN_API = "shodan_api"
    CENSYS_API = "censys_api"
    MANUAL_IMPORT = "manual_import"
    SENSOR_REPORT = "sensor_report"


class DeviceConfidence(str, Enum):
    """Confidence level for device identification."""
    LOW = "low"  # Partial fingerprint match
    MEDIUM = "medium"  # Good fingerprint + banner grab
    HIGH = "high"  # Full identification (banner, SNMP, heartbeat)
    CRITICAL = "critical"  # Authenticated + correlated to known asset


class NetworkSensor(Base):
    """represents a network monitoring sensor or data source."""
    __tablename__ = "network_sensors"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)  # e.g., "Plant A North Subnet Sensor"
    sensor_type = Column(String, nullable=False)  # snmp_poller, zeek, suricata, custom_agent, shodan, etc.
    endpoint_url = Column(String, nullable=True)  # API endpoint or syslog server
    api_token = Column(String, nullable=True)  # Encrypted API key
    location = Column(String, nullable=True)  # Physical location (Plant A, Control Room 3, etc.)
    network_segment = Column(String, nullable=True)  # Network CIDR or name
    enabled = Column(Boolean, default=True)
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    last_discovery_count = Column(Integer, default=0)
    configuration = Column(JSON, nullable=True)  # Custom config per sensor type
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="network_sensors")
    discovered_devices = relationship("DiscoveredDevice", back_populates="source_sensor", cascade="all, delete-orphan")


class DiscoveredDevice(Base):
    """Represents a device discovered passively without manual asset creation."""
    __tablename__ = "discovered_devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sensor_id = Column(Integer, ForeignKey("network_sensors.id"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)  # Link to managed asset if correlated

    # Network identifiers
    ip_address = Column(String, nullable=False)
    mac_address = Column(String, nullable=True)
    hostname = Column(String, nullable=True)

    # Device fingerprinting
    device_class = Column(String, nullable=True)  # PLC, HMI, RTU, Server, etc.
    manufacturer = Column(String, nullable=True)
    model = Column(String, nullable=True)
    firmware_version = Column(String, nullable=True)
    serial_number = Column(String, nullable=True)
    
    # Communication & protocols
    ports_open = Column(JSON, nullable=True)  # List of detected ports
    services_detected = Column(JSON, nullable=True)  # List of services (Modbus, HTTP, SSH, etc.)
    protocols = Column(JSON, nullable=True)  # List of identified protocols
    
    # OT-specific fingerprint
    is_ot_device = Column(Boolean, default=False)
    ot_device_type = Column(String, nullable=True)  # plc, hmi, rtu, ied, scada_server
    industrial_protocols = Column(JSON, nullable=True)  # [modbus, profinet, dnp3, etc.]
    
    # Confidence & metadata
    confidence = Column(String, default=DeviceConfidence.MEDIUM.value)  # low, medium, high, critical
    discovery_method = Column(String, nullable=False)
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    
    # Actor/risk scoring
    risk_score = Column(Float, default=0.0)  # 0-100
    risk_factors = Column(JSON, nullable=True)  # [exposed_services, outdated_firmware, unpatched_cves, etc]
    
    # User correlation state
    is_correlated = Column(Boolean, default=False)  # True if matched to managed asset
    correlation_score = Column(Float, nullable=True)  # 0-100 fuzzy match score
    
    # Notes and metadata
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)  # Custom user tags
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="discovered_devices")
    source_sensor = relationship("NetworkSensor", back_populates="discovered_devices")
    correlated_asset = relationship("Asset", foreign_keys=[asset_id])


# Pydantic models

class NetworkSensorBase(BaseModel):
    """Base network sensor schema."""
    name: str
    sensor_type: str
    endpoint_url: Optional[str] = None
    location: Optional[str] = None
    network_segment: Optional[str] = None
    enabled: Optional[bool] = True
    configuration: Optional[Dict[str, Any]] = None

    model_config = {"from_attributes": True}


class NetworkSensorCreate(NetworkSensorBase):
    """Schema for sensor creation."""
    api_token: Optional[str] = None

    model_config = {"from_attributes": True}


class NetworkSensorUpdate(BaseModel):
    """Schema for sensor updates."""
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    location: Optional[str] = None
    network_segment: Optional[str] = None
    enabled: Optional[bool] = None
    configuration: Optional[Dict[str, Any]] = None
    api_token: Optional[str] = None

    model_config = {"from_attributes": True}


class NetworkSensorResponse(NetworkSensorBase):
    """Schema for sensor response."""
    id: int
    user_id: int
    last_heartbeat: Optional[datetime] = None
    last_discovery_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceBase(BaseModel):
    """Base discovered device schema."""
    ip_address: str
    mac_address: Optional[str] = None
    hostname: Optional[str] = None
    device_class: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    serial_number: Optional[str] = None
    is_ot_device: Optional[bool] = False
    ot_device_type: Optional[str] = None
    confidence: Optional[str] = DeviceConfidence.MEDIUM.value
    description: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceCreate(DiscoveredDeviceBase):
    """Schema for discovered device creation."""
    sensor_id: Optional[int] = None
    ports_open: Optional[List[int]] = None
    services_detected: Optional[List[str]] = None
    protocols: Optional[List[str]] = None
    industrial_protocols: Optional[List[str]] = None
    discovery_method: str

    model_config = {"from_attributes": True}


class DiscoveredDeviceUpdate(BaseModel):
    """Schema for discovered device updates."""
    hostname: Optional[str] = None
    device_class: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    ot_device_type: Optional[str] = None
    is_ot_device: Optional[bool] = None
    confidence: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceResponse(DiscoveredDeviceBase):
    """Schema for discovered device response."""
    id: int
    user_id: int
    sensor_id: Optional[int] = None
    asset_id: Optional[int] = None
    ports_open: Optional[List[int]] = None
    services_detected: Optional[List[str]] = None
    protocols: Optional[List[str]] = None
    industrial_protocols: Optional[List[str]] = None
    risk_score: float
    risk_factors: Optional[List[str]] = None
    is_correlated: bool
    correlation_score: Optional[float] = None
    first_seen: datetime
    last_seen: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceListResponse(BaseModel):
    """Schema for discovered device list response."""
    devices: List[DiscoveredDeviceResponse]
    total: int
    page: int
    size: int

    model_config = {"from_attributes": True}
