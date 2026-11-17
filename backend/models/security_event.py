"""Security event models for ingested telemetry (Suricata, Zeek, syslog, etc.)."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

from backend.database.db import Base


class EventSourceType(StrEnum):
    SURICATA = "suricata"
    ZEEK = "zeek"
    SYSLOG = "syslog"
    FIREWALL = "firewall"
    AUTH_LOG = "auth_log"
    CLOUD_IAM = "cloud_iam"
    UPLOAD = "upload"
    WEBHOOK = "webhook"


class EventSeverity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class EventSource(Base):
    """Tracks telemetry sources feeding events into the platform."""
    __tablename__ = "event_sources"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    source_type = Column(String, nullable=False)
    status = Column(String, default="active")  # active | inactive | error
    event_count = Column(Integer, default=0)
    last_event_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    events = relationship("SecurityEvent", back_populates="source")


class SecurityEvent(Base):
    """Normalized security event from any telemetry source."""
    __tablename__ = "security_events"
    __table_args__ = (
        Index("ix_security_events_timestamp", "timestamp"),
        Index("ix_security_events_user_source", "user_id", "source_id"),
        Index("ix_security_events_severity", "severity"),
        Index("ix_security_events_src_ip", "source_ip"),
        Index("ix_security_events_dest_ip", "dest_ip"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    source_id = Column(Integer, ForeignKey("event_sources.id"), nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    event_type = Column(String, nullable=False)  # alert, dns, http, conn, auth, flow
    severity = Column(String, default="info")
    signature = Column(String, nullable=True)  # Suricata rule name / Zeek notice
    signature_id = Column(String, nullable=True)
    category = Column(String, nullable=True)  # e.g. "Attempted Admin Privilege Gain"
    source_ip = Column(String, nullable=True)
    source_port = Column(Integer, nullable=True)
    dest_ip = Column(String, nullable=True)
    dest_port = Column(Integer, nullable=True)
    protocol = Column(String, nullable=True)  # tcp, udp, icmp
    action = Column(String, nullable=True)  # allowed, blocked, dropped
    hostname = Column(String, nullable=True)
    username = Column(String, nullable=True)
    domain = Column(String, nullable=True)
    url = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    bytes_in = Column(Integer, nullable=True)
    bytes_out = Column(Integer, nullable=True)
    raw_data = Column(JSON, nullable=True)  # Full original event
    source_type = Column(String, nullable=True)  # suricata, zeek, etc.
    processed = Column(String, default="pending")  # pending | triaged | in_case
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    source = relationship("EventSource", back_populates="events")


# --- Pydantic schemas ---

class SecurityEventCreate(BaseModel):
    timestamp: datetime
    event_type: str
    severity: str = "info"
    signature: str | None = None
    signature_id: str | None = None
    category: str | None = None
    source_ip: str | None = None
    source_port: int | None = None
    dest_ip: str | None = None
    dest_port: int | None = None
    protocol: str | None = None
    action: str | None = None
    hostname: str | None = None
    username: str | None = None
    domain: str | None = None
    url: str | None = None
    user_agent: str | None = None
    bytes_in: int | None = None
    bytes_out: int | None = None
    raw_data: dict | None = None
    source_type: str | None = None
    model_config = {"from_attributes": True}


class SecurityEventResponse(SecurityEventCreate):
    id: int
    user_id: int
    source_id: int | None = None
    processed: str = "pending"
    created_at: datetime
    model_config = {"from_attributes": True}


class EventBatchIngest(BaseModel):
    """Batch of events for webhook/upload ingestion."""
    source_type: str = "webhook"
    source_name: str | None = None
    events: list[dict]  # Raw events, will be parsed by source-specific parser


class EventListResponse(BaseModel):
    events: list[SecurityEventResponse]
    total: int
    page: int
    size: int
    model_config = {"from_attributes": True}


class EventSourceResponse(BaseModel):
    id: int
    name: str
    source_type: str
    status: str
    event_count: int
    last_event_at: datetime | None = None
    created_at: datetime
    model_config = {"from_attributes": True}
