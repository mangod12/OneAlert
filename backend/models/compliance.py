"""
Compliance models for tracking framework controls and assessments.

This module defines SQLAlchemy ORM models for compliance frameworks (IEC 62443,
NIST CSF 2.0, etc.), their controls, and user assessments against those controls.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ComplianceFramework(Base):
    __tablename__ = "compliance_frameworks"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # "IEC 62443", "NIST CSF 2.0", "NERC CIP", "NIS2"
    version = Column(String, nullable=False)
    description = Column(Text, nullable=True)


class ComplianceControl(Base):
    __tablename__ = "compliance_controls"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("compliance_frameworks.id"), nullable=False)
    control_id = Column(String, nullable=False)  # e.g., "SR 3.3", "CIP-007-7 R2"
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True)  # Foundational Requirement or Function


class ComplianceAssessment(Base):
    __tablename__ = "compliance_assessments"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    control_id = Column(Integer, ForeignKey("compliance_controls.id"), nullable=False)
    status = Column(String, default="not_assessed")  # compliant | non_compliant | partial | not_applicable | not_assessed
    evidence_type = Column(String, nullable=True)  # automated | manual | document
    evidence_detail = Column(Text, nullable=True)
    assessed_at = Column(DateTime(timezone=True), server_default=func.now())
    assessed_by = Column(String, default="system")  # "system" or user email


# Pydantic schemas
class FrameworkResponse(BaseModel):
    id: int
    name: str
    version: str
    description: Optional[str] = None
    model_config = {"from_attributes": True}


class ControlResponse(BaseModel):
    id: int
    framework_id: int
    control_id: str
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    model_config = {"from_attributes": True}


class AssessmentResponse(BaseModel):
    id: int
    user_id: int
    control_id: int
    status: str
    evidence_type: Optional[str] = None
    evidence_detail: Optional[str] = None
    assessed_at: datetime
    assessed_by: str
    model_config = {"from_attributes": True}


class AssessmentUpdate(BaseModel):
    status: str
    evidence_type: Optional[str] = None
    evidence_detail: Optional[str] = None
    model_config = {"from_attributes": True}


class ComplianceSummary(BaseModel):
    framework_id: int
    framework_name: str
    total_controls: int
    compliant: int
    non_compliant: int
    partial: int
    not_assessed: int
    compliance_percentage: float
    model_config = {"from_attributes": True}
