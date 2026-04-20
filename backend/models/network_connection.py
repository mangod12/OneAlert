"""
Network Connection model for topology mapping.

Tracks observed connections between devices/IPs on the network,
enabling graph-based topology visualization and anomaly detection.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger, Boolean
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class NetworkConnection(Base):
    __tablename__ = "network_connections"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    source_device_id = Column(Integer, ForeignKey("discovered_devices.id"), nullable=True)
    target_device_id = Column(Integer, ForeignKey("discovered_devices.id"), nullable=True)
    source_ip = Column(String, nullable=False)
    target_ip = Column(String, nullable=False)
    protocol = Column(String, nullable=False)  # modbus, dnp3, https, ssh, etc.
    port = Column(Integer, nullable=True)
    direction = Column(String, default="bidirectional")  # inbound | outbound | bidirectional
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), server_default=func.now())
    bytes_transferred = Column(BigInteger, default=0)
    is_encrypted = Column(Boolean, default=False)


# Pydantic schemas
class ConnectionCreate(BaseModel):
    source_ip: str
    target_ip: str
    protocol: str
    port: Optional[int] = None
    direction: str = "bidirectional"
    is_encrypted: bool = False
    bytes_transferred: int = 0
    source_device_id: Optional[int] = None
    target_device_id: Optional[int] = None
    model_config = {"from_attributes": True}


class ConnectionResponse(BaseModel):
    id: int
    source_ip: str
    target_ip: str
    protocol: str
    port: Optional[int] = None
    direction: str
    is_encrypted: bool
    bytes_transferred: int
    first_seen: datetime
    last_seen: datetime
    source_device_id: Optional[int] = None
    target_device_id: Optional[int] = None
    model_config = {"from_attributes": True}


class TopologyNode(BaseModel):
    id: str  # IP or device ID
    label: str
    type: str  # device | gateway | unknown
    zone: Optional[str] = None
    risk_score: float = 0
    model_config = {"from_attributes": True}


class TopologyEdge(BaseModel):
    source: str
    target: str
    protocol: str
    is_encrypted: bool
    port: Optional[int] = None
    model_config = {"from_attributes": True}


class TopologyGraph(BaseModel):
    nodes: list
    edges: list
    model_config = {"from_attributes": True}
