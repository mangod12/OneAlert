"""Read-only component lookup across retained, owned SBOM documents."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent, SBOMComponentResponse
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.sbom_component_query import component_conditions

router = APIRouter()


@router.get('/component-search')
async def search_recorded_components(
    search: Annotated[str, Query(min_length=1, max_length=200, pattern=r'.*\S.*')],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    version: Annotated[str, Query(max_length=200)] = '',
    vulnerable_only: bool = False,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Return matching saved rows, never inferred installations or live CVE coverage."""
    query, exact_version = search.strip(), version.strip()
    conditions = component_conditions(current_user.id, query, exact_version, vulnerable_only)
    source = select(SBOMComponent).join(SBOM, SBOM.id == SBOMComponent.sbom_id).join(Asset, Asset.id == SBOM.asset_id)
    counts = (await db.execute(select(func.count(SBOMComponent.id), func.count(func.distinct(SBOM.id)),
                                     func.count(func.distinct(Asset.id)))
                              .select_from(SBOMComponent).join(SBOM, SBOM.id == SBOMComponent.sbom_id)
                              .join(Asset, Asset.id == SBOM.asset_id).where(*conditions))).one()
    rows = (await db.execute(source.add_columns(SBOM, Asset).where(*conditions)
                            .order_by(SBOMComponent.id.desc()).offset((page - 1) * size).limit(size))).all()
    return {'search': query, 'version': exact_version, 'vulnerable_only': vulnerable_only, 'page': page, 'size': size,
            'total': counts[0], 'document_count': counts[1], 'asset_count': counts[2],
            'retrieved_at': datetime.now(UTC).isoformat(),
            'records': [{'component': SBOMComponentResponse.model_validate(component),
                         'sbom_id': sbom.id, 'asset_id': asset.id, 'asset_name': asset.name,
                         'document_created_at': sbom.created_at, 'document_source': sbom.source,
                         'document_format': sbom.format}
                        for component, sbom, asset in rows]}


@router.get('/component-search/assets')
async def component_affected_assets(
    search: Annotated[str, Query(min_length=1, max_length=200, pattern=r'.*\S.*')],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 10,
    version: Annotated[str, Query(max_length=200)] = '',
    vulnerable_only: bool = False,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Group matching saved rows by owned asset, not installed software or confirmed exposure."""
    query, exact_version = search.strip(), version.strip()
    conditions = component_conditions(current_user.id, query, exact_version, vulnerable_only)
    base = (select(Asset.id.label('asset_id'), Asset.name.label('asset_name'),
                   func.count(SBOMComponent.id).label('matching_rows'),
                   func.count(func.distinct(SBOM.id)).label('document_count'),
                   func.count(func.distinct(func.nullif(SBOMComponent.version, ''))).label('recorded_version_count'),
                   func.sum(case((or_missing_version(), 1), else_=0)).label('missing_version_rows'),
                   func.sum(case((SBOMComponent.has_known_vulnerability > 0, 1), else_=0))
                   .label('rows_with_recorded_vulnerabilities'),
                   func.max(SBOM.created_at).label('newest_matching_document_at'))
            .select_from(SBOMComponent).join(SBOM, SBOM.id == SBOMComponent.sbom_id)
            .join(Asset, Asset.id == SBOM.asset_id).where(*conditions).group_by(Asset.id, Asset.name))
    grouped = base.subquery()
    total = (await db.execute(select(func.count()).select_from(grouped))).scalar_one()
    records = (await db.execute(select(grouped).order_by(
        grouped.c.rows_with_recorded_vulnerabilities.desc(), grouped.c.matching_rows.desc(), grouped.c.asset_id,
    ).offset((page - 1) * size).limit(size))).mappings().all()
    return {'search': query, 'version': exact_version, 'vulnerable_only': vulnerable_only,
            'page': page, 'size': size, 'total': total, 'retrieved_at': datetime.now(UTC).isoformat(),
            'assets': [dict(row) for row in records]}


def or_missing_version():
    return (SBOMComponent.version.is_(None)) | (SBOMComponent.version == '')
