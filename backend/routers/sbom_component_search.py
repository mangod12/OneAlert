"""Read-only component lookup across retained, owned SBOM documents."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent, SBOMComponentResponse
from backend.models.user import User
from backend.routers.auth import get_active_user

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
    needle = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    conditions = [SBOM.user_id == current_user.id, Asset.user_id == current_user.id,
                  or_(*(getattr(SBOMComponent, field).ilike(needle, escape='\\')
                        for field in ('name', 'supplier', 'purl', 'cpe')))]
    if exact_version:
        conditions.append(SBOMComponent.version == exact_version)
    if vulnerable_only:
        conditions.append(SBOMComponent.has_known_vulnerability > 0)
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
