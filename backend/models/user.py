"""
User model for authentication and user management.

This module defines the SQLAlchemy ORM model for users and the Pydantic
schemas for user-related API operations (registration, login, profile, etc).

- The `User` class is the database model for users.
- The Pydantic models (`UserBase`, `UserCreate`, `UserUpdate`, `UserResponse`, `Token`,
  `TokenData`) are used for request/response validation and serialization.
"""

from datetime import datetime

from fastapi import Depends
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

from backend.database.db import Base, get_async_db
from backend.services.auth_service import validate_new_password


class User(Base):
    """SQLAlchemy User model."""
    __tablename__ = "users"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=True)  # Nullable for OAuth users
    full_name = Column(String, nullable=True)
    company = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # GitHub OAuth fields
    github_id = Column(String, unique=True, nullable=True, index=True)
    github_username = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    auth_provider = Column(String, default="email")  # "email" or "github"
    role = Column(String, default="viewer")  # 'admin', 'analyst', 'viewer'

    # Organization (multi-tenancy)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)

    # Per-user email notification preferences
    email_notifications_enabled = Column(Boolean, nullable=False, server_default="1")
    notify_min_severity = Column(String, nullable=False, server_default="low")
    # in-app notification kinds hidden from the user's feed
    muted_kinds = Column(JSON, nullable=False, server_default="[]", default=list)
    quiet_hours_start = Column(String, nullable=True)  # "22:00" local wall clock
    quiet_hours_end = Column(String, nullable=True)    # "06:00"; null pair = quiet hours off
    digest_enabled = Column(Boolean, nullable=False, server_default="0")
    digest_hour_utc = Column(Integer, nullable=False, server_default="7")  # hour the daily digest goes out
    # Incident auto-escalation: open an investigation when an asset gets noisy enough
    auto_escalate_incidents = Column(Boolean, nullable=False, server_default="0")
    auto_escalate_min_alerts = Column(Integer, nullable=False, server_default="3")
    auto_escalate_min_severity = Column(String, nullable=False, server_default="high")
    sla_due_dates_enabled = Column(Boolean, nullable=False, server_default="0")
    auto_assign_new_alerts = Column(Boolean, nullable=False, server_default="0")
    sla_days_critical = Column(Integer, nullable=False, server_default="1")
    sla_days_high = Column(Integer, nullable=False, server_default="3")
    sla_days_medium = Column(Integer, nullable=False, server_default="7")
    sla_days_low = Column(Integer, nullable=False, server_default="14")
    sla_days_info = Column(Integer, nullable=False, server_default="30")
    organization = relationship("Organization", back_populates="users")

    # Slack and webhook URLs
    slack_webhook_url = Column(String, nullable=True)
    webhook_url = Column(String, nullable=True)

    # MFA fields
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String, nullable=True)

    # Relationships
    assets = relationship("Asset", back_populates="user", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="user", cascade="all, delete-orphan", foreign_keys="Alert.user_id")
    network_sensors = relationship("NetworkSensor", back_populates="user", cascade="all, delete-orphan")
    discovered_devices = relationship("DiscoveredDevice", back_populates="user", cascade="all, delete-orphan")


# Pydantic models for API
class UserBase(BaseModel):
    """Base user schema."""
    email: EmailStr
    full_name: str | None = None
    company: str | None = None
    slack_webhook_url: str | None = None
    webhook_url: str | None = None
    mfa_enabled: bool | None = False

    model_config = {"from_attributes": True}


class UserCreate(UserBase):
    """Schema for user creation."""
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_new_password(value)

    model_config = {"from_attributes": True}


class GitHubUserCreate(BaseModel):
    """Schema for GitHub OAuth user creation."""
    github_id: str
    github_username: str
    email: str
    full_name: str | None = None
    company: str | None = None
    avatar_url: str | None = None
    slack_webhook_url: str | None = None
    webhook_url: str | None = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """Schema for user updates."""
    full_name: str | None = None
    company: str | None = None
    password: str | None = None
    slack_webhook_url: str | None = None
    webhook_url: str | None = None
    mfa_enabled: bool | None = False
    mfa_secret: str | None = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        return validate_new_password(value) if value is not None else value

    model_config = {"from_attributes": True}


class PasswordChange(BaseModel):
    """Schema for changing the current user's password."""
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new(cls, value: str) -> str:
        return validate_new_password(value)

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    """Editable profile fields for the current user."""
    full_name: str | None = None
    company: str | None = None

    model_config = {"from_attributes": True}


SEVERITY_LEVELS = ("low", "medium", "high", "critical")

# In-app notification kinds that can be muted individually.
KNOWN_NOTIFICATION_KINDS = (
    "alert_created", "case_assigned", "alert_assigned",
    "incident_escalated", "case_sla_breached", "case_sla_due_soon",
    "alert_updated", "alert_watching", "alert_mention",
    "case_updated", "case_watching", "case_mention",
)


class NotificationPreferences(BaseModel):
    """Per-user notification preferences."""
    email_notifications_enabled: bool
    notify_min_severity: str
    muted_kinds: list[str] = []
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    digest_enabled: bool
    digest_hour_utc: int

    model_config = {"from_attributes": True}


QUIET_HOURS_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class NotificationPreferencesUpdate(BaseModel):
    """Partial update for notification preferences."""
    email_notifications_enabled: bool | None = None
    notify_min_severity: str | None = Field(
        default=None, pattern="^(low|medium|high|critical)$"
    )
    muted_kinds: list[str] | None = None
    quiet_hours_start: str | None = Field(default=None, pattern=QUIET_HOURS_PATTERN)
    quiet_hours_end: str | None = Field(default=None, pattern=QUIET_HOURS_PATTERN)
    digest_enabled: bool | None = None
    digest_hour_utc: int | None = Field(default=None, ge=0, le=23)

    @model_validator(mode="after")
    def _quiet_hours_paired(self):
        if (self.quiet_hours_start is None) != (self.quiet_hours_end is None):
            raise ValueError("Quiet hours need both a start and an end time")
        return self

    @field_validator("muted_kinds")
    @classmethod
    def _known_kinds_only(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        unknown = [kind for kind in value if kind not in KNOWN_NOTIFICATION_KINDS]
        if unknown:
            raise ValueError(f"Unknown notification kinds: {', '.join(unknown)}")
        return value


class UserResponse(BaseModel):
    """Schema for user response."""
    id: int
    email: EmailStr
    full_name: str | None = None
    company: str | None = None
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: datetime | None = None
    org_id: int | None = None
    mfa_enabled: bool | None = False

    model_config = {"from_attributes": True}


class Token(BaseModel):
    """Token response schema."""
    access_token: str
    token_type: str

    model_config = {"from_attributes": True}


class TokenData(BaseModel):
    """Token payload schema."""
    email: str | None = None

    model_config = {"from_attributes": True}


async def list_users(db: AsyncSession = Depends(get_async_db)) -> list[User]:
    result = await db.execute(select(User))
    return result.scalars().all()


class AutomationPreferences(BaseModel):
    """Per-user response automation preferences."""
    auto_escalate_incidents: bool
    auto_escalate_min_alerts: int
    auto_escalate_min_severity: str
    sla_due_dates_enabled: bool
    auto_assign_new_alerts: bool
    sla_days_critical: int
    sla_days_high: int
    sla_days_medium: int
    sla_days_low: int
    sla_days_info: int

    model_config = {"from_attributes": True}


class AutomationPreferencesUpdate(BaseModel):
    """Partial update for response automation preferences."""
    auto_escalate_incidents: bool | None = None
    auto_escalate_min_alerts: int | None = Field(default=None, ge=2, le=20)
    auto_escalate_min_severity: str | None = Field(
        default=None, pattern="^(low|medium|high|critical)$"
    )
    sla_due_dates_enabled: bool | None = None
    auto_assign_new_alerts: bool | None = None
    sla_days_critical: int | None = Field(default=None, ge=1, le=90)
    sla_days_high: int | None = Field(default=None, ge=1, le=90)
    sla_days_medium: int | None = Field(default=None, ge=1, le=90)
    sla_days_low: int | None = Field(default=None, ge=1, le=90)
    sla_days_info: int | None = Field(default=None, ge=1, le=90)
