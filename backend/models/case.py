"""Case and investigation models — AI-generated investigation containers."""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

from backend.database.db import Base


class CaseStatus(StrEnum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    CLOSED = "closed"
    FALSE_POSITIVE = "false_positive"


class CaseSeverity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Case(Base):
    """Investigation case grouping related alerts and events."""
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    severity = Column(String, default="medium")
    status = Column(String, default="open")
    confidence_score = Column(Float, nullable=True)  # 0.0-1.0
    mitre_tactics = Column(JSON, nullable=True)  # ["TA0001", "TA0008"]
    mitre_techniques = Column(JSON, nullable=True)  # [{"id": "T1078", "name": "Valid Accounts", "confidence": 0.85}]
    attack_narrative = Column(Text, nullable=True)  # AI-generated attack story
    created_by = Column(String, default="system")  # "agent", "human", "system"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    case_alerts = relationship("CaseAlert", back_populates="case", cascade="all, delete-orphan")
    case_events = relationship("CaseEvent", back_populates="case", cascade="all, delete-orphan")
    timeline_entries = relationship(
        "CaseTimeline", back_populates="case", cascade="all, delete-orphan", order_by="CaseTimeline.timestamp"
    )


class CaseAlert(Base):
    """Join table linking cases to alerts."""
    __tablename__ = "case_alerts"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False)

    case = relationship("Case", back_populates="case_alerts")
    alert = relationship("Alert")


class CaseEvent(Base):
    """Join table linking cases to security events."""
    __tablename__ = "case_events"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(Integer, ForeignKey("security_events.id"), nullable=False)

    case = relationship("Case", back_populates="case_events")
    event = relationship("SecurityEvent")


class CaseTimeline(Base):
    """Timeline entry for a case investigation."""
    __tablename__ = "case_timeline"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    entry_type = Column(String, nullable=False)  # event, alert, action, note, ai_analysis
    content = Column(Text, nullable=False)
    source = Column(String, default="system")  # agent, human, system
    metadata_json = Column(JSON, nullable=True)

    case = relationship("Case", back_populates="timeline_entries")


# --- Agent Ledger ---

class AgentRun(Base):
    """Record of an AI agent execution."""
    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_type = Column(String, nullable=False)  # triage, detect, hunt, response
    status = Column(String, default="running")  # running, completed, failed, cancelled
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    model_used = Column(String, nullable=True)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    result_summary = Column(Text, nullable=True)

    steps = relationship(
        "AgentStep", back_populates="run", cascade="all, delete-orphan", order_by="AgentStep.step_number"
    )


class AgentStep(Base):
    """Individual step within an agent run."""
    __tablename__ = "agent_steps"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    step_number = Column(Integer, nullable=False)
    action = Column(String, nullable=False)  # analyze_alerts, correlate, call_llm, create_case
    input_summary = Column(Text, nullable=True)
    output_summary = Column(Text, nullable=True)
    tool_used = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    run = relationship("AgentRun", back_populates="steps")


# --- Pydantic Schemas ---

class CaseCreate(BaseModel):
    """Schema for opening an investigation manually."""
    title: str = Field(min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2000)
    severity: Literal["info", "low", "medium", "high", "critical"] = "medium"
    model_config = {"extra": "forbid"}


class CaseResponse(BaseModel):
    id: int
    user_id: int
    title: str
    summary: str | None = None
    severity: str
    status: str
    confidence_score: float | None = None
    mitre_tactics: list | None = None
    mitre_techniques: list | None = None
    attack_narrative: str | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime | None = None
    alert_count: int = 0
    event_count: int = 0
    model_config = {"from_attributes": True}


class CaseListResponse(BaseModel):
    cases: list[CaseResponse]
    total: int
    page: int
    size: int
    model_config = {"from_attributes": True}


class TimelineEntryResponse(BaseModel):
    id: int
    timestamp: datetime
    entry_type: str
    content: str
    source: str
    metadata_json: dict | None = None
    model_config = {"from_attributes": True}


class CaseDetailResponse(CaseResponse):
    timeline: list[TimelineEntryResponse] = []
    model_config = {"from_attributes": True}


class AgentRunResponse(BaseModel):
    id: int
    agent_type: str
    status: str
    started_at: datetime
    completed_at: datetime | None = None
    model_used: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    result_summary: str | None = None
    # model_used legitimately lives under the model_ prefix here
    model_config = {"from_attributes": True, "protected_namespaces": ()}
