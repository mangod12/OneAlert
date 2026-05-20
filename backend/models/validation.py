"""Purple-team validation models — test runs, steps, and control results."""

from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON
from backend.database.db import Base
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ValidationRun(Base):
    """A purple-team validation run against a scoped set of assets."""
    __tablename__ = "validation_runs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, default="pending")  # pending, running, completed, failed, cancelled
    mode = Column(String, default="dry_run")  # dry_run, lab, production
    scope = Column(JSON, nullable=True)  # {"cidr": [], "asset_ids": [], "techniques": [], "excluded": []}
    mitre_techniques = Column(JSON, default=list)  # ATT&CK technique IDs to test
    results_summary = Column(JSON, nullable=True)  # {"tested": N, "detected": N, "missed": N}
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    approved_by = Column(Integer, nullable=True)

    steps = relationship("ValidationStep", back_populates="run", cascade="all, delete-orphan")


class ValidationStep(Base):
    """Individual test step within a validation run."""
    __tablename__ = "validation_steps"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False)
    step_number = Column(Integer, nullable=False)
    technique_id = Column(String, nullable=False)  # MITRE ATT&CK technique ID (e.g., T1059)
    technique_name = Column(String, nullable=False)
    test_name = Column(String, nullable=False)  # e.g., "PowerShell execution via WMI"
    test_type = Column(String, default="atomic")  # atomic, caldera, manual, nmap, nuclei
    status = Column(String, default="pending")  # pending, running, completed, skipped
    simulated = Column(Boolean, default=True)  # True = dry-run/simulated, False = live execution
    command = Column(Text, nullable=True)  # Command or payload used
    expected_detection = Column(Text, nullable=True)  # What detection should fire
    actual_result = Column(String, nullable=True)  # detected, missed, partial, error
    evidence = Column(JSON, nullable=True)  # Artifacts, logs, screenshots
    duration_ms = Column(Integer, nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=True)

    run = relationship("ValidationRun", back_populates="steps")


class ControlResult(Base):
    """Maps validation steps to detection controls and their effectiveness."""
    __tablename__ = "control_results"

    id = Column(Integer, primary_key=True, index=True)
    step_id = Column(Integer, ForeignKey("validation_steps.id", ondelete="CASCADE"), nullable=False)
    control_name = Column(String, nullable=False)  # e.g., "Suricata rule SID:2024001"
    control_type = Column(String, nullable=False)  # suricata, sigma, yara, edr, manual
    expected = Column(Boolean, default=True)  # Should this control detect the technique?
    detected = Column(Boolean, default=False)  # Did it actually detect?
    detection_time_ms = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Pydantic schemas
class ValidationRunResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    mode: str
    scope: Optional[dict] = None
    mitre_techniques: list = []
    results_summary: Optional[dict] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class ValidationStepResponse(BaseModel):
    id: int
    step_number: int
    technique_id: str
    technique_name: str
    test_name: str
    test_type: str
    status: str
    simulated: bool
    actual_result: Optional[str] = None
    duration_ms: Optional[int] = None
    executed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class ValidationRunCreate(BaseModel):
    name: str
    description: Optional[str] = None
    mode: str = "dry_run"
    scope: Optional[dict] = None
    mitre_techniques: List[str] = []


class ControlResultResponse(BaseModel):
    id: int
    control_name: str
    control_type: str
    expected: bool
    detected: bool
    detection_time_ms: Optional[int] = None
    details: Optional[str] = None
    model_config = {"from_attributes": True}
