"""
SBOM router for uploading, listing, and managing Software Bills of Materials.

Provides endpoints for SBOM upload (CycloneDX/SPDX JSON), listing, detail
retrieval, component listing, and deletion.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.sbom import (
    SBOM,
    SBOMComponent,
    SBOMResponse,
    SBOMComponentResponse,
    SBOMUpload,
)
from backend.routers.auth import get_active_user
from backend.services.sbom_service import parse_cyclonedx, parse_spdx

router = APIRouter()


@router.post("/upload", response_model=SBOMResponse, status_code=status.HTTP_201_CREATED)
async def upload_sbom(
    payload: SBOMUpload,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Upload an SBOM JSON document for an asset.

    Accepts CycloneDX or SPDX JSON in the `sbom_data` field.
    Auto-detects format based on presence of `bomFormat` or `spdxVersion` keys.
    """
    # Verify the asset belongs to the current user
    result = await db.execute(
        select(Asset).where(
            Asset.id == payload.asset_id,
            Asset.user_id == current_user.id,
        )
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found",
        )

    sbom_data = payload.sbom_data

    # Detect format and parse
    if "bomFormat" in sbom_data:
        sbom_format = "CycloneDX"
        spec_version = sbom_data.get("specVersion", "")
        parsed_components = parse_cyclonedx(sbom_data)
    elif "spdxVersion" in sbom_data:
        sbom_format = "SPDX"
        spec_version = sbom_data.get("spdxVersion", "")
        parsed_components = parse_spdx(sbom_data)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported SBOM format. Must contain 'bomFormat' (CycloneDX) or 'spdxVersion' (SPDX).",
        )

    # Create SBOM record
    db_sbom = SBOM(
        asset_id=payload.asset_id,
        user_id=current_user.id,
        format=sbom_format,
        version=spec_version,
        source=payload.source,
        component_count=len(parsed_components),
        vulnerability_count=0,
    )
    db.add(db_sbom)
    await db.flush()  # Get the SBOM id

    # Create component records
    for comp in parsed_components:
        db_component = SBOMComponent(
            sbom_id=db_sbom.id,
            name=comp["name"],
            version=comp.get("version"),
            supplier=comp.get("supplier"),
            purl=comp.get("purl"),
            cpe=comp.get("cpe"),
            license=comp.get("license"),
            hash_sha256=comp.get("hash_sha256"),
            has_known_vulnerability=0,
        )
        db.add(db_component)

    await db.commit()
    await db.refresh(db_sbom)

    return db_sbom


@router.get("/", response_model=List[SBOMResponse])
async def list_sboms(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all SBOMs for the current user."""
    result = await db.execute(
        select(SBOM)
        .where(SBOM.user_id == current_user.id)
        .order_by(SBOM.created_at.desc())
    )
    sboms = result.scalars().all()
    return sboms


@router.get("/{sbom_id}", response_model=SBOMResponse)
async def get_sbom(
    sbom_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a specific SBOM by ID."""
    result = await db.execute(
        select(SBOM).where(
            SBOM.id == sbom_id,
            SBOM.user_id == current_user.id,
        )
    )
    sbom = result.scalar_one_or_none()

    if not sbom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SBOM not found",
        )

    return sbom


@router.get("/{sbom_id}/components", response_model=List[SBOMComponentResponse])
async def get_sbom_components(
    sbom_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all components of a specific SBOM."""
    # Verify SBOM belongs to user
    result = await db.execute(
        select(SBOM).where(
            SBOM.id == sbom_id,
            SBOM.user_id == current_user.id,
        )
    )
    sbom = result.scalar_one_or_none()

    if not sbom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SBOM not found",
        )

    # Get components
    result = await db.execute(
        select(SBOMComponent).where(SBOMComponent.sbom_id == sbom_id)
    )
    components = result.scalars().all()
    return components


@router.delete("/{sbom_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sbom(
    sbom_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete an SBOM and its components (cascade)."""
    result = await db.execute(
        select(SBOM)
        .where(
            SBOM.id == sbom_id,
            SBOM.user_id == current_user.id,
        )
        .options(selectinload(SBOM.components))
    )
    sbom = result.scalar_one_or_none()

    if not sbom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SBOM not found",
        )

    await db.delete(sbom)
    await db.commit()
