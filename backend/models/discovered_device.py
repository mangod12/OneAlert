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

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database.db import Base


class DiscoveryMethod(StrEnum):
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


class DeviceConfidence(StrEnum):
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
    endpoint_url: str | None = None
    location: str | None = None
    network_segment: str | None = None
    enabled: bool | None = True
    configuration: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class NetworkSensorCreate(NetworkSensorBase):
    """Schema for sensor creation."""
    api_token: str | None = None

    model_config = {"from_attributes": True}


class NetworkSensorUpdate(BaseModel):
    """Schema for sensor updates."""
    name: str | None = None
    endpoint_url: str | None = None
    location: str | None = None
    network_segment: str | None = None
    enabled: bool | None = None
    configuration: dict[str, Any] | None = None
    api_token: str | None = None

    model_config = {"from_attributes": True}


class NetworkSensorResponse(NetworkSensorBase):
    """Schema for sensor response."""
    id: int
    user_id: int
    last_heartbeat: datetime | None = None
    last_discovery_count: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceBase(BaseModel):
    """Base discovered device schema."""
    ip_address: str
    mac_address: str | None = None
    hostname: str | None = None
    device_class: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    firmware_version: str | None = None
    serial_number: str | None = None
    is_ot_device: bool | None = False
    ot_device_type: str | None = None
    confidence: str | None = DeviceConfidence.MEDIUM.value
    description: str | None = None
    notes: str | None = None
    tags: list[str] | None = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceCreate(DiscoveredDeviceBase):
    """Schema for discovered device creation."""
    sensor_id: int | None = None
    ports_open: list[int] | None = None
    services_detected: list[str] | None = None
    protocols: list[str] | None = None
    industrial_protocols: list[str] | None = None
    discovery_method: str

    model_config = {"from_attributes": True}


class DiscoveredDeviceUpdate(BaseModel):
    """Schema for discovered device updates."""
    hostname: str | None = None
    device_class: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    firmware_version: str | None = None
    ot_device_type: str | None = None
    is_ot_device: bool | None = None
    confidence: str | None = None
    notes: str | None = None
    tags: list[str] | None = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceResponse(DiscoveredDeviceBase):
    """Schema for discovered device response."""
    id: int
    user_id: int
    sensor_id: int | None = None
    asset_id: int | None = None
    ports_open: list[int] | None = None
    services_detected: list[str] | None = None
    protocols: list[str] | None = None
    industrial_protocols: list[str] | None = None
    risk_score: float
    risk_factors: list[str] | None = None
    is_correlated: bool
    correlation_score: float | None = None
    first_seen: datetime
    last_seen: datetime
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class DiscoveredDeviceListResponse(BaseModel):
    """Schema for discovered device list response."""
    devices: list[DiscoveredDeviceResponse]
    total: int
    page: int
    size: int

    model_config = {"from_attributes": True}
