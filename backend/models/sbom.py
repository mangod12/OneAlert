"""
SBOM (Software Bill of Materials) models for tracking software components.

This module defines the SQLAlchemy ORM models for SBOMs and their components,
along with Pydantic schemas for API request/response validation.

- The `SBOM` class tracks uploaded SBOM documents per asset.
- The `SBOMComponent` class tracks individual software components within an SBOM.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SBOM(Base):
    """SQLAlchemy model for Software Bill of Materials documents."""

    __tablename__ = "sboms"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    format = Column(String, nullable=False)  # CycloneDX | SPDX
    version = Column(String, nullable=True)
    source = Column(String, default="upload")  # upload | scan | vendor_provided
    component_count = Column(Integer, default=0)
    vulnerability_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    components = relationship(
        "SBOMComponent", back_populates="sbom", cascade="all, delete-orphan"
    )


class SBOMComponent(Base):
    """SQLAlchemy model for individual software components within an SBOM."""

    __tablename__ = "sbom_components"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True)
    sbom_id = Column(Integer, ForeignKey("sboms.id"), nullable=False)
    name = Column(String, nullable=False)
    version = Column(String, nullable=True)
    supplier = Column(String, nullable=True)
    purl = Column(String, nullable=True)  # Package URL
    cpe = Column(String, nullable=True)
    license = Column(String, nullable=True)
    hash_sha256 = Column(String, nullable=True)
    has_known_vulnerability = Column(Integer, default=0)  # count of known CVEs

    sbom = relationship("SBOM", back_populates="components")


# Pydantic schemas


class SBOMResponse(BaseModel):
    """Schema for SBOM response."""

    id: int
    asset_id: int
    format: str
    version: Optional[str] = None
    source: str
    component_count: int
    vulnerability_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class SBOMComponentResponse(BaseModel):
    """Schema for SBOM component response."""

    id: int
    sbom_id: int
    name: str
    version: Optional[str] = None
    supplier: Optional[str] = None
    purl: Optional[str] = None
    cpe: Optional[str] = None
    license: Optional[str] = None
    has_known_vulnerability: int

    model_config = {"from_attributes": True}


class SBOMUpload(BaseModel):
    """Schema for SBOM upload request."""

    asset_id: int
    sbom_data: dict
    source: str = "upload"

    model_config = {"from_attributes": True}
