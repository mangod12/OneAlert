"""Current owner-visible records referencing an exact managed asset."""
from datetime import UTC, datetime

from sqlalchemy import String, cast, func, or_, select

from backend.models.alert import Alert
from backend.models.discovered_device import DiscoveredDevice
from backend.models.sbom import SBOM
from backend.models.suppression_rule import AlertSuppressionRule

KINDS = {
    'alerts': (Alert, ('id', 'title', 'severity', 'status', 'cve_id', 'created_at')),
    'sboms': (SBOM, ('id', 'format', 'source', 'version', 'component_count', 'vulnerability_count', 'created_at')),
    'discovered_devices': (DiscoveredDevice, ('id', 'ip_address', 'hostname', 'manufacturer', 'model',
                                            'is_correlated', 'first_seen', 'last_seen')),
    'suppression_rules': (AlertSuppressionRule, ('id', 'name', 'enabled', 'severity', 'cve_id',
                                              'title_contains', 'duration_hours', 'created_at')),
}


async def asset_linked_records(db, asset, user_id, kind, page, size, search):
    counts = {}
    unavailable = 0
    for key, (model, _) in KINDS.items():
        all_count = (await db.execute(select(func.count()).select_from(model)
                                     .where(model.asset_id == asset.id))).scalar_one()
        counts[key] = (await db.execute(select(func.count()).select_from(model).where(
            model.asset_id == asset.id, model.user_id == user_id,
        ))).scalar_one()
        unavailable += all_count - counts[key]
    model, fields = KINDS[kind]
    predicates = [model.asset_id == asset.id, model.user_id == user_id]
    if search:
        needle = '%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        predicates.append(or_(*(cast(getattr(model, field), String).ilike(needle, escape='\\')
                                for field in fields if field not in {'created_at', 'first_seen', 'last_seen'})))
    total = (await db.execute(select(func.count()).select_from(model).where(*predicates))).scalar_one()
    rows = (await db.execute(select(model).where(*predicates).order_by(model.id.desc())
                            .offset((page - 1) * size).limit(size))).scalars().all()
    return {'asset_id': asset.id, 'asset_name': asset.name, 'kind': kind, 'page': page, 'size': size,
            'search': search, 'total': total, 'counts': counts, 'unavailable_reference_count': unavailable,
            'retrieved_at': datetime.now(UTC).isoformat(),
            'records': [{field: getattr(row, field) for field in fields} for row in rows]}
