"""
Subscription model for billing and plan management.

Tracks Stripe subscription state per organization, plan limits,
and provides Pydantic schemas for API serialization.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    plan = Column(String, default="free")  # free | starter | pro | enterprise
    status = Column(String, default="active")  # active | past_due | canceled | trialing
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# Plan limits
PLAN_LIMITS = {
    "free": {"max_assets": 10, "max_users": 1, "features": ["basic_alerts"]},
    "starter": {"max_assets": 100, "max_users": 5, "features": ["basic_alerts", "epss", "slack_integration"]},
    "pro": {"max_assets": 500, "max_users": 20, "features": ["basic_alerts", "epss", "slack_integration", "compliance", "sbom", "topology"]},
    "enterprise": {"max_assets": 99999, "max_users": 99999, "features": ["all"]},
}


# Pydantic schemas
class SubscriptionResponse(BaseModel):
    id: int
    org_id: int
    plan: str
    status: str
    stripe_subscription_id: Optional[str] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class PlanInfo(BaseModel):
    plan: str
    max_assets: int
    max_users: int
    features: list
    price_monthly: Optional[int] = None  # in cents
    model_config = {"from_attributes": True}


class CheckoutRequest(BaseModel):
    plan: str  # starter | pro | enterprise
    success_url: str = "/settings?billing=success"
    cancel_url: str = "/settings?billing=canceled"
    model_config = {"from_attributes": True}
