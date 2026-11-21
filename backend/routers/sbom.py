"""
SBOM router for uploading, listing, and managing Software Bills of Materials.

Provides endpoints for SBOM upload (CycloneDX/SPDX JSON), listing, detail
retrieval, component listing, and deletion.
"""


import csv
import io
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database.db import get_async_db
from backend.models.asset import Asset
from backend.models.sbom import (
    SBOM,
    SBOMComponent,
    SBOMComponentResponse,
    SBOMResponse,
    SBOMUpload,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.routers.sbom_component_search import router as component_search_router
from backend.services.sbom_service import (
    SBOMDocumentBudgetExceeded,
    parse_cyclonedx,
    parse_cyclonedx_vulnerabilities,
    parse_spdx,
    validate_sbom_document_budget,
)

router = APIRouter()
router.include_router(component_search_router)


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
    try:
        validate_sbom_document_budget(sbom_data)
    except SBOMDocumentBudgetExceeded as exc:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail="SBOM document exceeds the 5 MiB normalized JSON limit. "
                                   "Use a smaller document; no SBOM was saved.") from exc
    except (ValueError, RecursionError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="SBOM must be a finite UTF-8 JSON document with supported nesting. "
                                   "No SBOM was saved.") from exc

    # Detect format and parse
    vuln_map: dict[str, set[str]] = {}
    if "bomFormat" in sbom_data:
        sbom_format = "CycloneDX"
        spec_version = sbom_data.get("specVersion", "")
        try:
            parsed_components = parse_cyclonedx(sbom_data)
            vuln_map = parse_cyclonedx_vulnerabilities(sbom_data)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid CycloneDX component evidence: {exc}",
            ) from exc
    elif "spdxVersion" in sbom_data:
        sbom_format = "SPDX"
        spec_version = sbom_data.get("spdxVersion", "")
        try:
            parsed_components = parse_spdx(sbom_data)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid SPDX component evidence: {exc}",
            ) from exc
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported SBOM format. Must contain 'bomFormat' (CycloneDX) or 'spdxVersion' (SPDX).",
        )

    # Create SBOM record
    distinct_vulns = {vuln_id for ids in vuln_map.values() for vuln_id in ids}
    db_sbom = SBOM(
        asset_id=payload.asset_id,
        user_id=current_user.id,
        format=sbom_format,
        version=spec_version,
        source=payload.source,
        component_count=len(parsed_components),
        vulnerability_count=len(distinct_vulns),
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
            has_known_vulnerability=len(vuln_map.get(comp.get("bom_ref") or "", set())),
        )
        db.add(db_component)

    await db.commit()
    await db.refresh(db_sbom)

    return db_sbom


@router.get("/", response_model=list[SBOMResponse])
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


@router.get("/document-library")
async def browse_sbom_documents(
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    query: Annotated[str, Query(max_length=200)] = "",
    asset_id: Annotated[int | None, Query(ge=1)] = None,
    document_format: Annotated[str, Query(max_length=100)] = "",
    source: Annotated[str, Query(max_length=100)] = "",
    vulnerabilities_only: bool = False,
    sort: Literal["newest", "oldest"] = "newest",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Bounded owned-document discovery, independent of loaded legacy inventory."""
    statement = (select(SBOM, Asset.name).outerjoin(
        Asset, (Asset.id == SBOM.asset_id) & (Asset.user_id == current_user.id),
    ).where(SBOM.user_id == current_user.id))
    if query.strip():
        statement = statement.where(or_(*[
            func.lower(func.coalesce(cast(column, String), "")).contains(query.strip().lower(), autoescape=True)
            for column in (SBOM.id, SBOM.asset_id, SBOM.version, SBOM.source, SBOM.format, Asset.name)
        ]))
    if asset_id is not None:
        statement = statement.where(SBOM.asset_id == asset_id)
    if document_format:
        statement = statement.where(SBOM.format == document_format)
    if source:
        statement = statement.where(SBOM.source == source)
    if vulnerabilities_only:
        statement = statement.where(SBOM.vulnerability_count > 0)
    total = (await db.execute(select(func.count()).select_from(statement.subquery()))).scalar_one()
    order = ([SBOM.created_at.asc(), SBOM.id.asc()] if sort == "oldest" else
             [SBOM.created_at.desc(), SBOM.id.desc()])
    rows = (await db.execute(statement.order_by(*order).offset((page - 1) * size).limit(size))).all()
    options = {}
    for key, column in [("formats", SBOM.format), ("sources", SBOM.source)]:
        values = (await db.execute(select(column).where(SBOM.user_id == current_user.id)
                                   .distinct().order_by(column))).scalars().all()
        options[key] = [value for value in values if value is not None]
    return {"page": page, "size": size, "total": total, "query": query.strip(), "asset_id": asset_id,
            "document_format": document_format, "source": source, "vulnerabilities_only": vulnerabilities_only,
            "sort": sort, **options, "retrieved_at": datetime.now(UTC).isoformat(),
            "documents": [{**SBOMResponse.model_validate(document).model_dump(), "asset_name": name}
                          for document, name in rows]}


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


@router.get("/{sbom_id}/components", response_model=list[SBOMComponentResponse])
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


@router.get("/{sbom_id}/component-evidence")
async def browse_sbom_component_evidence(
    sbom_id: int,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    search: Annotated[str, Query(max_length=200)] = "",
    vulnerable_only: bool = False,
    component_id: Annotated[int | None, Query(ge=1, le=2147483647)] = None,
    gap: Literal["", "version", "supplier", "license", "identifiers", "hash"] = "",
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Search and page saved component evidence without loading the whole document inventory."""
    sbom = (await db.execute(select(SBOM).where(
        SBOM.id == sbom_id, SBOM.user_id == current_user.id,
    ))).scalar_one_or_none()
    if sbom is None:
        raise HTTPException(status_code=404, detail="SBOM not found")
    predicates = [SBOMComponent.sbom_id == sbom_id]
    if component_id is not None:
        exists = (await db.execute(select(SBOMComponent.id).where(
            SBOMComponent.id == component_id, SBOMComponent.sbom_id == sbom_id))).scalar_one_or_none()
        if exists is None:
            raise HTTPException(status_code=404, detail="Component not found in this SBOM")
        predicates.append(SBOMComponent.id == component_id)
    query = search.strip()
    if query:
        needle = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        predicates.append(or_(*(getattr(SBOMComponent, field).ilike(needle, escape='\\') for field in (
            "name", "version", "supplier", "purl", "cpe", "license", "hash_sha256"
        ))))
    if vulnerable_only:
        predicates.append(SBOMComponent.has_known_vulnerability > 0)
    def missing(column):
        return func.trim(func.coalesce(column, "")) == ""
    if gap == "identifiers":
        predicates.extend([missing(SBOMComponent.purl), missing(SBOMComponent.cpe)])
    elif gap:
        predicates.append(missing(getattr(SBOMComponent, "hash_sha256" if gap == "hash" else gap)))
    total = (await db.execute(select(func.count()).select_from(SBOMComponent).where(*predicates))).scalar_one()
    document_total = (await db.execute(select(func.count()).select_from(SBOMComponent)
                                      .where(SBOMComponent.sbom_id == sbom_id))).scalar_one()
    rows = (await db.execute(select(SBOMComponent).where(*predicates)
                            .order_by(SBOMComponent.name, SBOMComponent.id)
                            .offset((page - 1) * size).limit(size))).scalars().all()
    return {"sbom": SBOMResponse.model_validate(sbom), "page": page, "size": size, "search": query,
            "vulnerable_only": vulnerable_only, "gap": gap, "total": total, "document_total": document_total,
            "retrieved_at": datetime.now(UTC).isoformat(), "component_id": component_id,
            "components": [SBOMComponentResponse.model_validate(row) for row in rows]}


@router.get("/{sbom_id}/export")
async def export_sbom_components(
    sbom_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Export an SBOM's component list as CSV."""
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

    result = await db.execute(
        select(SBOMComponent)
        .where(SBOMComponent.sbom_id == sbom.id)
        .order_by(SBOMComponent.name)
    )
    components = result.scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "name", "version", "supplier", "purl", "cpe", "license", "hash_sha256", "known_vulnerabilities",
    ])
    def spreadsheet_text(value):
        # CSV quoting alone does not prevent spreadsheet formula interpretation.
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    for component in components:
        writer.writerow([spreadsheet_text(value) for value in [
            component.name,
            component.version or "",
            component.supplier or "",
            component.purl or "",
            component.cpe or "",
            component.license or "",
            component.hash_sha256 or "",            component.has_known_vulnerability,
        ]])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sbom-{sbom.id}-components.csv"},
    )


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
