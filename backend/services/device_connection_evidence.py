"""Read-only device connection evidence without conflating IP matches with identity."""
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.discovered_device import DiscoveredDevice
from backend.models.network_connection import NetworkConnection


async def device_connection_evidence(
    db: AsyncSession, user_id: int, device_id: int, page: int, size: int,
    match: Literal['all', 'record', 'ip'], encryption: Literal['all', 'encrypted', 'cleartext'],
) -> dict:
    device = (await db.execute(select(DiscoveredDevice).where(
        DiscoveredDevice.id == device_id, DiscoveredDevice.user_id == user_id,
    ))).scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail='Device not found')
    record_match = or_(NetworkConnection.source_device_id == device_id, NetworkConnection.target_device_id == device_id)
    ip_match = or_(NetworkConnection.source_ip == device.ip_address, NetworkConnection.target_ip == device.ip_address)
    predicates = [NetworkConnection.user_id == user_id,
                  record_match if match == 'record' else ip_match if match == 'ip' else or_(record_match, ip_match)]
    if encryption != 'all':
        predicates.append(NetworkConnection.is_encrypted.is_(encryption == 'encrypted'))
    total = (await db.execute(select(func.count()).select_from(NetworkConnection).where(*predicates))).scalar_one()
    rows = (await db.execute(select(NetworkConnection).where(*predicates)
                            .order_by(NetworkConnection.last_seen.desc().nullslast(), NetworkConnection.id.desc())
                            .offset((page - 1) * size).limit(size))).scalars().all()
    connections = []
    for row in rows:
        linked = row.source_device_id == device_id or row.target_device_id == device_id
        ip_matched = row.source_ip == device.ip_address or row.target_ip == device.ip_address
        connections.append({
            'id': row.id, 'source': row.source_ip, 'target': row.target_ip,
            'protocol': row.protocol, 'port': row.port, 'direction': row.direction,
            'is_encrypted': row.is_encrypted,
            'bytes_transferred_exact': str(row.bytes_transferred) if row.bytes_transferred is not None else None,
            'first_seen': row.first_seen, 'last_seen': row.last_seen,
            'source_device_id': row.source_device_id, 'target_device_id': row.target_device_id,
            'record_reference_match': linked, 'ip_address_match': ip_matched,
        })
    return {'device_id': device.id, 'ip_address': device.ip_address, 'page': page, 'size': size,
            'total': total, 'match': match, 'encryption': encryption,
            'retrieved_at': datetime.now(UTC), 'connections': connections}
