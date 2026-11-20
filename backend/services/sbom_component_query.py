"""Shared literal-match and ownership scope for retained component evidence."""
from sqlalchemy import or_

from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent


def component_conditions(user_id: int, search: str, version: str, vulnerable_only: bool):
    query = search.strip()
    needle = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    conditions = [SBOM.user_id == user_id, Asset.user_id == user_id,
                  or_(*(getattr(SBOMComponent, field).ilike(needle, escape='\\')
                        for field in ('name', 'supplier', 'purl', 'cpe')))]
    if version.strip():
        conditions.append(SBOMComponent.version == version.strip())
    if vulnerable_only:
        conditions.append(SBOMComponent.has_known_vulnerability > 0)
    return conditions
