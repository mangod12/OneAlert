"""Saved filter views: named, per-user snapshots of list filters (alerts, cases or events)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.types import JSON

from backend.database.db import Base


class SavedView(Base):
    """A named set of list filters owned by one user, scoped to a page."""

    __tablename__ = "saved_views"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    scope = Column(String(16), nullable=False, default="alerts", server_default="alerts")
    name = Column(String(80), nullable=False)
    filters = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SavedViewFilters(BaseModel):
    """Subset of the alerts-list query parameters captured in a saved view."""

    severity: str | None = None
    status: str | None = None
    search: str | None = None
    asset_id: int | None = None
    assigned: str | None = None
    sort: str | None = None
    model_config = {"extra": "forbid"}


class CaseViewFilters(BaseModel):
    """Subset of the cases-list query parameters captured in a saved view."""

    search: str | None = Field(None, max_length=200)

    severity: str | None = None
    status: str | None = None
    assigned: str | None = None
    overdue: bool | None = None
    sort: str | None = None
    model_config = {"extra": "forbid"}


class EventViewFilters(BaseModel):
    """Subset of the events-list query parameters captured in a saved view."""

    started_at: AwareDatetime | None = None
    ended_before: AwareDatetime | None = None
    severity: str | None = None
    event_type: str | None = None
    source_type: str | None = None
    source_id: int | None = Field(None, ge=1)
    ip: str | None = None
    signature: str | None = None
    sort: str | None = None
    model_config = {"extra": "forbid"}


    @model_validator(mode="after")
    def validate_time_window(self):
        if self.started_at and self.ended_before and self.started_at >= self.ended_before:
            raise ValueError("Start must be before the exclusive end time")
        return self


class AssetViewFilters(BaseModel):
    """Inventory query only; never saves record selection or comparison evidence."""

    search: str | None = Field(None, max_length=200)
    asset_type: str | None = Field(None, max_length=100)
    vendor: str | None = Field(None, max_length=200)
    criticality: Literal["low", "medium", "high", "critical"] | None = None
    is_ot: bool | None = None
    sort: Literal["created_at_desc", "created_at_asc", "name_asc", "name_desc",
                  "criticality_desc", "criticality_asc", "risk_desc"] | None = None
    model_config = {"extra": "forbid"}


FILTERS_MODELS = {"alerts": SavedViewFilters, "cases": CaseViewFilters,
                 "events": EventViewFilters, "assets": AssetViewFilters}


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: dict[str, Any] = Field(default_factory=dict)
    model_config = {"extra": "forbid"}


class SavedViewRename(BaseModel):
    """Rename body for a saved view."""

    name: str = Field(min_length=1, max_length=80)
    model_config = {"extra": "forbid"}


class SavedViewResponse(BaseModel):
    id: int
    name: str
    scope: str
    filters: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True
