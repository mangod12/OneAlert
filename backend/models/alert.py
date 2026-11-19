"""
Alert model for vulnerability notifications.

This module defines the SQLAlchemy ORM model for alerts and the Pydantic
schemas for alert-related API operations (create, read, etc).

- The `Alert` class is the database model for alerts.
- The `Severity` and `AlertStatus` enums define the severity and status of alerts.
- The Pydantic models (`AlertBase`, `AlertCreate`, `AlertRead`) are used
  for request/response validation and serialization.
"""

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field  # Ensure compatibility with Pydantic v2
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database.db import Base


class Severity(StrEnum):
    """Vulnerability severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(StrEnum):
    """Alert status enumeration."""
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class Alert(Base):
    """SQLAlchemy Alert model."""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cve_id = Column(String, nullable=True)  # CVE-2023-1234
    vendor_advisory_id = Column(String, nullable=True)  # Vendor-specific ID
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String, nullable=False)
    cvss_score = Column(Float, nullable=True)
    exploitability = Column(Float, nullable=True)
    remediation = Column(Text, nullable=True)
    status = Column(String, default=AlertStatus.PENDING)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    snoozed_until = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(Date, nullable=True)  # analyst-set triage target date
    sla_breach_notified_at = Column(DateTime(timezone=True), nullable=True)  # set once an overdue notification was sent
    # set once a due-tomorrow warning was sent
    sla_due_soon_notified_at = Column(DateTime(timezone=True), nullable=True)
    source_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="alerts", foreign_keys=[user_id])
    assignee = relationship("User", foreign_keys=[assigned_to_id])
    asset = relationship("Asset", back_populates="alerts")
    watchers = relationship("AlertWatcher", back_populates="alert", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "asset_id": self.asset_id,
            "cve_id": self.cve_id,
            "vendor_advisory_id": self.vendor_advisory_id,
            "title": self.title,
            "description": self.description,
            "severity": self.severity.value if hasattr(self.severity, 'value') else self.severity,
            "cvss_score": self.cvss_score,
            "status": self.status.value if hasattr(self.status, 'value') else self.status,
            "remediation": self.remediation,
            "assigned_to_id": self.assigned_to_id,
            "source_url": self.source_url,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "snoozed_until": self.snoozed_until.isoformat() if self.snoozed_until else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
        }


# Pydantic models for API
class AlertWatcher(Base):
    """An organization member following an alert for status notifications."""
    __tablename__ = "alert_watchers"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("alert_id", "user_id", name="uq_alert_watchers_alert_user"),
    )

    alert = relationship("Alert", back_populates="watchers")
    user = relationship("User")


class AlertWatcherAdd(BaseModel):
    user_id: int


class AlertWatcherResponse(BaseModel):
    user_id: int
    email: str
    full_name: str | None = None


class AlertBase(BaseModel):
    """Base alert schema."""
    cve_id: str | None = None
    vendor_advisory_id: str | None = None
    title: str
    description: str | None = None
    severity: Severity
    cvss_score: float | None = None
    source_url: str | None = None

    model_config = {"from_attributes": True}


class AlertCreate(AlertBase):
    """Schema for alert creation."""
    asset_id: int

    model_config = {"from_attributes": True}


class AlertRead(AlertBase):
    """Schema for reading alerts, including DB-generated fields."""
    id: int
    user_id: int
    asset_id: int
    status: AlertStatus
    sent_at: datetime | None = None
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    snoozed_until: datetime | None = None
    due_date: date | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class AutoAssignRequest(BaseModel):
    alert_ids: list[int]


class AlertSnoozeRequest(BaseModel):
    """Snooze an alert for a number of hours."""
    hours: int = Field(gt=0, le=720)
    model_config = {"extra": "forbid"}


class AlertUpdate(BaseModel):
    """Schema for alert updates."""
    status: AlertStatus | None = None
    acknowledged_at: datetime | None = None
    assigned_to_id: int | None = None  # send explicit null to unassign
    due_date: date | None = None  # send explicit null to clear the triage target

    model_config = {"from_attributes": True}


class AlertResponse(AlertBase):
    """Schema for alert response."""
    id: int
    user_id: int
    asset_id: int
    status: AlertStatus
    sent_at: datetime | None = None
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    snoozed_until: datetime | None = None
    due_date: date | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class AlertWithAsset(AlertResponse):
    """Alert response with asset information."""
    asset_name: str
    asset_vendor: str | None = None
    asset_product: str | None = None
    assigned_to_id: int | None = None
    assigned_to_email: str | None = None

    model_config = {"from_attributes": True }


class AlertListResponse(BaseModel):
    """Schema for alert list response."""
    alerts: list[AlertWithAsset]
    total: int
    page: int
    size: int
    pages: int = 1

    model_config = {"from_attributes": True }


class AlertStats(BaseModel):
    """Alert statistics schema."""
    total_alerts: int
    critical_alerts: int
    high_alerts: int
    medium_alerts: int
    low_alerts: int
    pending_alerts: int
    acknowledged_alerts: int

    model_config = {"from_attributes": True }


def get_alerts():
    """Return a list of alerts (stub for dashboard)."""
    return []
