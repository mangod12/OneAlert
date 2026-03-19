"""
Asset model for tracking user devices and software.

This module defines the SQLAlchemy ORM model for assets and the Pydantic
schemas for asset-related API operations (create, update, list, etc).

- The `Asset` class is the database model for assets.
- The `AssetType` enum defines the type of asset (hardware, software, etc).
- The Pydantic models (`AssetBase`, `AssetCreate`, `AssetUpdate`, `AssetResponse`, `AssetListResponse`) are used for request/response validation and serialization.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel, Field  # Ensure compatibility with Pydantic v2
from typing import Optional, List
from datetime import datetime
from enum import Enum


class AssetType(str, Enum):
    """Asset type enumeration."""
    HARDWARE = "hardware"
    SOFTWARE = "software"
    FIRMWARE = "firmware"
    OPERATING_SYSTEM = "operating_system"
    # Industrial/OT asset types
    PLC = "plc"
    HMI = "hmi"
    RTU = "rtu"
    IED = "ied"  # Intelligent Electronic Device
    SCADA_SERVER = "scada_server"
    HISTORIAN = "historian"
    ENGINEERING_WORKSTATION = "engineering_workstation"
    INDUSTRIAL_NETWORK = "industrial_network"
    OTHER_OT = "other_ot"


class NetworkZone(str, Enum):
    """Network zone classification (Purdue model inspired)."""
    IT = "it"  # Enterprise IT
    DEMILITARIZED = "dmz"  # DMZ / Access zones
    SUPERVISORY = "supervisory"  # Purdue Level 3 - SCADA/MES
    CONTROL = "control"  # Purdue Level 2 - PLC/RTU controllers
    FIELD = "field"  # Purdue Level 1 - Sensors/actuators
    SAFETY_SYSTEM = "safety_system"  # SIS / ESD systems
    UNKNOWN = "unknown"


class CommunicationProtocol(str, Enum):
    """Industrial communication protocols."""
    MODBUS = "modbus"
    PROFIBUS = "profibus"
    PROFINET = "profinet"
    ETHERNET_IP = "ethernet_ip"
    DNP3 = "dnp3"
    FOUNDATION_FIELDBUS = "foundation_fieldbus"
    HART = "hart"
    OPC_UA = "opc_ua"
    HTTP = "http"
    HTTPS = "https"
    UNKNOWN = "unknown"


class Asset(Base):
    """SQLAlchemy Asset model."""
    __tablename__ = "assets"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    asset_type = Column(String, nullable=False)  # hardware, software, firmware, etc.
    vendor = Column(String, nullable=True)
    product = Column(String, nullable=True)
    version = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    cpe_string = Column(String, nullable=True)  # Common Platform Enumeration
    
    # OT/ICS specific fields
    is_ot_asset = Column(Boolean, default=False)  # True if operational technology asset
    network_zone = Column(String, nullable=True, default="unknown")  # Purdue model zone
    primary_protocol = Column(String, nullable=True)  # Primary comms protocol
    secondary_protocols = Column(String, nullable=True)  # JSON list of protocols
    serial_number = Column(String, nullable=True)
    firmware_version = Column(String, nullable=True)
    model_number = Column(String, nullable=True)
    manufacturer_date = Column(DateTime(timezone=True), nullable=True)
    last_known_ip = Column(String, nullable=True)
    criticality = Column(String, default="medium")  # low, medium, high, critical
    discovery_method = Column(String, nullable=True)  # manual, snmp, shodan, sensor, etc.
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="assets")
    alerts = relationship("Alert", back_populates="asset")


# Pydantic models for API
class AssetBase(BaseModel):
    """Base asset schema."""
    name: str
    asset_type: AssetType
    vendor: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None
    description: Optional[str] = None
    cpe_string: Optional[str] = None
    # OT fields
    is_ot_asset: Optional[bool] = False
    network_zone: Optional[str] = "unknown"
    primary_protocol: Optional[str] = None
    secondary_protocols: Optional[str] = None  # JSON string of list
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    model_number: Optional[str] = None
    manufacturer_date: Optional[datetime] = None
    last_known_ip: Optional[str] = None
    criticality: Optional[str] = "medium"
    discovery_method: Optional[str] = None
    
    model_config = {"from_attributes": True}


class AssetCreate(AssetBase):
    """Schema for asset creation."""
    pass
    
    model_config = {"from_attributes": True}


class AssetUpdate(BaseModel):
    """Schema for asset updates."""
    name: Optional[str] = None
    asset_type: Optional[AssetType] = None
    vendor: Optional[str] = None
    product: Optional[str] = None
    version: Optional[str] = None
    description: Optional[str] = None
    cpe_string: Optional[str] = None
    # OT fields
    is_ot_asset: Optional[bool] = None
    network_zone: Optional[str] = None
    primary_protocol: Optional[str] = None
    secondary_protocols: Optional[str] = None
    serial_number: Optional[str] = None
    firmware_version: Optional[str] = None
    model_number: Optional[str] = None
    manufacturer_date: Optional[datetime] = None
    last_known_ip: Optional[str] = None
    criticality: Optional[str] = None
    discovery_method: Optional[str] = None
    
    model_config = {"from_attributes": True}


class AssetResponse(AssetBase):
    """Schema for asset response."""
    id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = {"from_attributes": True}


class AssetListResponse(BaseModel):
    """Schema for asset list response."""
    assets: List[AssetResponse]
    total: int
    page: int
    size: int
    
    model_config = {"from_attributes": True}