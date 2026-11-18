"""Alert suppression rules: auto-snooze new alerts that match known-noise criteria."""

from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from backend.database.db import Base

SEVERITIES = ("low", "medium", "high", "critical")


class AlertSuppressionRule(Base):
    """A user-scoped rule that snoozes newly created alerts matching all set criteria."""
    __tablename__ = "alert_suppression_rules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    cve_id = Column(String, nullable=True)  # exact CVE match, case-insensitive
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    severity = Column(String, nullable=True)  # exact severity: low, medium, high, critical
    title_contains = Column(String, nullable=True)  # case-insensitive substring of the title
    duration_hours = Column(Integer, nullable=False, default=24)  # snooze window
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


def rule_matches(rule: AlertSuppressionRule, *, cve_id: str | None, asset_id: int | None,
                 severity: str | None, title: str | None) -> bool:
    """True when every criterion set on the rule matches the alert."""
    if rule.cve_id and (cve_id or "").lower() != rule.cve_id.lower():
        return False
    if rule.asset_id is not None and asset_id != rule.asset_id:
        return False
    if rule.severity and (severity or "").lower() != rule.severity.lower():
        return False
    return not (rule.title_contains and rule.title_contains.lower() not in (title or "").lower())


def criteria_set(data: dict) -> bool:
    """At least one matching criterion must be present, or the rule would snooze everything."""
    return any(data.get(field) not in (None, "") for field in ("cve_id", "asset_id", "severity", "title_contains"))


# Pydantic schemas
class SuppressionRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    cve_id: str | None = None
    asset_id: int | None = None
    severity: str | None = Field(None, pattern="^(low|medium|high|critical)$")
    title_contains: str | None = None
    duration_hours: int = Field(24, ge=1, le=720)
    enabled: bool = True


class SuppressionRuleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    cve_id: str | None = None
    asset_id: int | None = None
    severity: str | None = Field(None, pattern="^(low|medium|high|critical)$")
    title_contains: str | None = None
    duration_hours: int | None = Field(None, ge=1, le=720)
    enabled: bool | None = None


class SuppressionRuleResponse(BaseModel):
    id: int
    name: str
    cve_id: str | None = None
    asset_id: int | None = None
    severity: str | None = None
    title_contains: str | None = None
    duration_hours: int
    enabled: bool
    created_at: datetime
    matching_active_alerts: int = 0
    model_config = {"from_attributes": True}
