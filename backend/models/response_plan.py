"""Response plan and approval workflow models."""

from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ResponsePlan(Base):
    """AI-generated response plan for a case."""
    __tablename__ = "response_plans"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    actions = Column(JSON, nullable=False)  # List of action dicts
    status = Column(String, default="draft")  # draft, pending_approval, approved, executing, completed, rejected
    autonomy_level = Column(String, default="L1")  # L0-L4
    created_by = Column(String, default="agent")
    approved_by = Column(Integer, nullable=True)  # user_id
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    case = relationship("Case")
    approval_requests = relationship("ApprovalRequest", back_populates="plan", cascade="all, delete-orphan")


class ApprovalRequest(Base):
    """Human approval request for response actions."""
    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("response_plans.id", ondelete="CASCADE"), nullable=False)
    requested_by = Column(String, default="agent")
    status = Column(String, default="pending")  # pending, approved, rejected
    reason = Column(Text, nullable=True)
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    plan = relationship("ResponsePlan", back_populates="approval_requests")


# Pydantic schemas
class ResponsePlanResponse(BaseModel):
    id: int
    case_id: int
    actions: list
    status: str
    autonomy_level: str
    created_by: str
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}
