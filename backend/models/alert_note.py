"""Alert notes: short investigation annotations attached to an alert."""

from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text

from backend.database.db import Base


class AlertNote(Base):
    """A note written by the alert's owner."""

    __tablename__ = "alert_notes"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AlertNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    model_config = {"extra": "forbid"}


class AlertNoteResponse(BaseModel):
    id: int
    alert_id: int
    body: str
    created_at: datetime

    class Config:
        from_attributes = True
