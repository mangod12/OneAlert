"""Saved filter views: named, per-user snapshots of list filters (alerts, cases or events)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
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

    severity: str | None = None
    status: str | None = None
    assigned: str | None = None
    overdue: bool | None = None
    sort: str | None = None
    model_config = {"extra": "forbid"}


class EventViewFilters(BaseModel):
    """Subset of the events-list query parameters captured in a saved view."""

    severity: str | None = None
    event_type: str | None = None
    source_type: str | None = None
    ip: str | None = None
    signature: str | None = None
    sort: str | None = None
    model_config = {"extra": "forbid"}


FILTERS_MODELS = {"alerts": SavedViewFilters, "cases": CaseViewFilters, "events": EventViewFilters}


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
