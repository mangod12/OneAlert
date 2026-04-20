"""
Organization model for multi-tenancy support.

This module defines the SQLAlchemy ORM model for organizations and the Pydantic
schemas for organization-related API operations (create, update, list, invite).

- The `Organization` class is the database model for organizations.
- The Pydantic models (`OrgCreate`, `OrgResponse`, `OrgUpdate`) are used for
  request/response validation and serialization.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Organization(Base):
    """SQLAlchemy Organization model for multi-tenancy."""
    __tablename__ = "organizations"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    plan = Column(String, default="free")  # free | starter | pro | enterprise
    max_assets = Column(Integer, default=50)
    max_users = Column(Integer, default=3)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    users = relationship("User", back_populates="organization")


# Pydantic schemas
class OrgCreate(BaseModel):
    """Schema for organization creation."""
    name: str
    slug: str
    plan: str = "free"
    model_config = {"from_attributes": True}


class OrgResponse(BaseModel):
    """Schema for organization response."""
    id: int
    name: str
    slug: str
    plan: str
    max_assets: int
    max_users: int
    created_at: datetime
    model_config = {"from_attributes": True}


class OrgUpdate(BaseModel):
    """Schema for organization updates."""
    name: Optional[str] = None
    plan: Optional[str] = None
    max_assets: Optional[int] = None
    max_users: Optional[int] = None
    model_config = {"from_attributes": True}
