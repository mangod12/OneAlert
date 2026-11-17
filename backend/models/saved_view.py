"""Saved filter views: named, per-user snapshots of alerts-list filters."""

from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.types import JSON

from backend.database.db import Base


class SavedView(Base):
    """A named set of alerts-list filters owned by one user."""

    __tablename__ = "saved_views"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
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


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: SavedViewFilters
    model_config = {"extra": "forbid"}


class SavedViewResponse(BaseModel):
    id: int
    name: str
    filters: SavedViewFilters
    created_at: datetime

    class Config:
        from_attributes = True
