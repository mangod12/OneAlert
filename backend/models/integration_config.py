"""Integration configuration model for SIEM/SOAR integrations."""
from datetime import datetime

from pydantic import BaseModel, field_validator
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from backend.database.db import Base


class IntegrationConfig(Base):
    __tablename__ = "integration_configs"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    integration_type = Column(String, nullable=False)  # splunk | sentinel | servicenow | pagerduty | jira
    name = Column(String, nullable=False)  # User-friendly name
    config = Column(JSON, nullable=False)  # Integration-specific config
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# Pydantic schemas
class IntegrationConfigCreate(BaseModel):
    integration_type: str
    name: str
    config: dict
    model_config = {"from_attributes": True}


class IntegrationConfigResponse(BaseModel):
    id: int
    integration_type: str
    name: str
    config: dict
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class IntegrationConfigUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
    is_active: bool | None = None
    model_config = {"from_attributes": True}


    @field_validator('name', 'config', 'is_active', mode='before')
    @classmethod
    def required_update_values_cannot_be_null(cls, value):
        if value is None:
            raise ValueError('This field cannot be null; omit it to keep its saved value')
        return value
