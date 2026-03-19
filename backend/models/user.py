"""
User model for authentication and user management.

This module defines the SQLAlchemy ORM model for users and the Pydantic
schemas for user-related API operations (registration, login, profile, etc).

- The `User` class is the database model for users.
- The Pydantic models (`UserBase`, `UserCreate`, `UserUpdate`, `UserResponse`, `Token`, `TokenData`) are used for request/response validation and serialization.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel, Field, EmailStr  # Ensure compatibility with Pydantic v2
from typing import Optional, List
from datetime import datetime
from fastapi import Depends, HTTPException, status
from backend.database.db import get_async_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


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

    # Slack and webhook URLs
    slack_webhook_url = Column(String, nullable=True)
    webhook_url = Column(String, nullable=True)

    # MFA fields
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String, nullable=True)

    # Relationships
    assets = relationship("Asset", back_populates="user", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="user", cascade="all, delete-orphan")
    network_sensors = relationship("NetworkSensor", back_populates="user", cascade="all, delete-orphan")
    discovered_devices = relationship("DiscoveredDevice", back_populates="user", cascade="all, delete-orphan")


# Pydantic models for API
class UserBase(BaseModel):
    """Base user schema."""
    email: EmailStr
    full_name: Optional[str] = None
    company: Optional[str] = None
    slack_webhook_url: Optional[str] = None
    webhook_url: Optional[str] = None
    mfa_enabled: Optional[bool] = False
    mfa_secret: Optional[str] = None
    
    model_config = {"from_attributes": True}


class UserCreate(UserBase):
    """Schema for user creation."""
    password: str
    
    model_config = {"from_attributes": True}


class GitHubUserCreate(BaseModel):
    """Schema for GitHub OAuth user creation."""
    github_id: str
    github_username: str
    email: str
    full_name: Optional[str] = None
    company: Optional[str] = None
    avatar_url: Optional[str] = None
    slack_webhook_url: Optional[str] = None
    webhook_url: Optional[str] = None
    
    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """Schema for user updates."""
    full_name: Optional[str] = None
    company: Optional[str] = None
    password: Optional[str] = None
    slack_webhook_url: Optional[str] = None
    webhook_url: Optional[str] = None
    mfa_enabled: Optional[bool] = False
    mfa_secret: Optional[str] = None
    
    model_config = {"from_attributes": True}


class UserResponse(UserBase):
    """Schema for user response."""
    id: int
    is_active: bool
    is_verified: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    slack_webhook_url: Optional[str] = None
    webhook_url: Optional[str] = None
    mfa_enabled: Optional[bool] = False
    mfa_secret: Optional[str] = None
    
    model_config = {"from_attributes": True}


class Token(BaseModel):
    """Token response schema."""
    access_token: str
    token_type: str
    
    model_config = {"from_attributes": True}


class TokenData(BaseModel):
    """Token payload schema."""
    email: Optional[str] = None
    
    model_config = {"from_attributes": True}


async def list_users(db: AsyncSession = Depends(get_async_db)) -> List[User]:
    result = await db.execute(select(User))
    return result.scalars().all()