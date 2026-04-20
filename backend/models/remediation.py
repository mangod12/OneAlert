"""
Remediation action model for AI-powered vulnerability remediation.

This module defines the SQLAlchemy ORM model for remediation actions and the
Pydantic schemas for remediation-related API operations.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, Float
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class RemediationAction(Base):
    """SQLAlchemy model for remediation actions linked to alerts."""
    __tablename__ = "remediation_actions"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False)
    action_type = Column(String, nullable=False)  # patch | compensating_control | network_segmentation | firmware_upgrade | accept_risk
    description = Column(Text, nullable=False)
    estimated_downtime_minutes = Column(Integer, nullable=True)
    requires_maintenance_window = Column(Boolean, default=False)
    priority = Column(Integer, default=1)  # 1 = do first
    status = Column(String, default="proposed")  # proposed | approved | in_progress | completed | rejected
    ai_confidence = Column(Float, default=1.0)  # 0.0-1.0
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Pydantic schemas
class RemediationResponse(BaseModel):
    """Schema for remediation action response."""
    id: int
    alert_id: int
    action_type: str
    description: str
    estimated_downtime_minutes: Optional[int] = None
    requires_maintenance_window: bool
    priority: int
    status: str
    ai_confidence: float
    created_at: datetime
    model_config = {"from_attributes": True}


class RemediationStatusUpdate(BaseModel):
    """Schema for updating remediation action status."""
    status: str  # approved | in_progress | completed | rejected
    model_config = {"from_attributes": True}
