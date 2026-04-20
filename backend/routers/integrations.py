"""
Integrations router for managing SIEM/SOAR integration configurations.
Provides CRUD endpoints for integration configs plus connection testing.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.integration_config import (
    IntegrationConfig,
    IntegrationConfigCreate,
    IntegrationConfigResponse,
    IntegrationConfigUpdate,
)
from backend.routers.auth import get_active_user
from backend.services.integrations.splunk import SplunkIntegration
from backend.services.integrations.sentinel import SentinelIntegration
from backend.services.integrations.servicenow import ServiceNowIntegration
from backend.services.integrations.pagerduty import PagerDutyIntegration

router = APIRouter()

AVAILABLE_TYPES = [
    {"type": "splunk", "name": "Splunk", "description": "Splunk HTTP Event Collector"},
    {"type": "sentinel", "name": "Microsoft Sentinel", "description": "Azure Log Analytics Data Collector"},
    {"type": "servicenow", "name": "ServiceNow", "description": "ServiceNow incident creation"},
    {"type": "pagerduty", "name": "PagerDuty", "description": "PagerDuty incident triggering"},
]

INTEGRATION_CLASSES = {
    "splunk": SplunkIntegration,
    "sentinel": SentinelIntegration,
    "servicenow": ServiceNowIntegration,
    "pagerduty": PagerDutyIntegration,
}


@router.get("/types")
async def list_integration_types(
    current_user: User = Depends(get_active_user),
):
    """List available integration types."""
    return {"success": True, "data": AVAILABLE_TYPES}


@router.get("/", response_model=None)
async def list_integrations(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List user's integration configurations."""
    result = await db.execute(
        select(IntegrationConfig).where(IntegrationConfig.user_id == current_user.id)
    )
    configs = result.scalars().all()
    return {
        "success": True,
        "data": [
            IntegrationConfigResponse.model_validate(c) for c in configs
        ],
    }


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_integration(
    payload: IntegrationConfigCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new integration configuration."""
    valid_types = [t["type"] for t in AVAILABLE_TYPES]
    if payload.integration_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid integration type. Must be one of: {valid_types}",
        )

    config = IntegrationConfig(
        user_id=current_user.id,
        integration_type=payload.integration_type,
        name=payload.name,
        config=payload.config,
        is_active=True,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return {
        "success": True,
        "data": IntegrationConfigResponse.model_validate(config),
    }


@router.patch("/{integration_id}", response_model=None)
async def update_integration(
    integration_id: int,
    payload: IntegrationConfigUpdate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Update an integration configuration."""
    result = await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.id == integration_id,
            IntegrationConfig.user_id == current_user.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Integration not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(config, key, value)

    await db.commit()
    await db.refresh(config)
    return {
        "success": True,
        "data": IntegrationConfigResponse.model_validate(config),
    }


@router.delete("/{integration_id}", status_code=status.HTTP_200_OK)
async def delete_integration(
    integration_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete an integration configuration."""
    result = await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.id == integration_id,
            IntegrationConfig.user_id == current_user.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Integration not found")

    await db.delete(config)
    await db.commit()
    return {"success": True, "data": None, "message": "Integration deleted"}


@router.post("/{integration_id}/test", response_model=None)
async def test_integration_connection(
    integration_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Test an integration connection."""
    result = await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.id == integration_id,
            IntegrationConfig.user_id == current_user.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Integration not found")

    integration_class = INTEGRATION_CLASSES.get(config.integration_type)
    if not integration_class:
        raise HTTPException(status_code=400, detail="Unsupported integration type")

    integration = integration_class(config.config)
    test_result = await integration.test_connection()
    return {"success": True, "data": test_result}
