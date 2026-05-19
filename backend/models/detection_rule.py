"""Detection rule and hunt session models."""

from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DetectionRule(Base):
    """AI-generated or manually created detection rule."""
    __tablename__ = "detection_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    rule_type = Column(String, nullable=False)  # sigma, suricata, yara, sql
    rule_content = Column(Text, nullable=False)
    mitre_techniques = Column(JSON, nullable=True)
    confidence = Column(String, default="medium")  # low, medium, high
    tested = Column(Boolean, default=False)
    enabled = Column(Boolean, default=True)
    created_by = Column(String, default="agent")  # agent, human
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HuntSession(Base):
    """Record of a threat hunting session."""
    __tablename__ = "hunt_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    hypothesis = Column(Text, nullable=False)
    status = Column(String, default="running")  # running, completed, failed
    queries_run = Column(Integer, default=0)
    findings_count = Column(Integer, default=0)
    result_data = Column(JSON, nullable=True)
    sigma_rule = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


# Pydantic schemas
class DetectionRuleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    rule_type: str
    rule_content: str
    mitre_techniques: Optional[list] = None
    confidence: str
    tested: bool
    enabled: bool
    created_by: str
    created_at: datetime
    model_config = {"from_attributes": True}


class HuntSessionResponse(BaseModel):
    id: int
    hypothesis: str
    status: str
    queries_run: int
    findings_count: int
    sigma_rule: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}
