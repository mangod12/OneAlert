"""
Network Topology router for connection mapping and graph visualization.

Provides endpoints for:
- Ingesting network connections (single and batch)
- Listing connections for a user
- Building the topology graph (nodes + edges)
- Connection statistics (protocol breakdown, encryption status)
"""


import hashlib
import hmac
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.discovered_device import DiscoveredDevice
from backend.models.network_connection import (
    ConnectionCreate,
    ConnectionResponse,
    NetworkConnection,
    TopologyGraph,
)
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.topology_service import build_topology_graph

router = APIRouter()


async def _check_device_ownership(db: AsyncSession, user_id: int, connections: list[ConnectionCreate]) -> None:
    ids = {identity for item in connections for identity in [item.source_device_id, item.target_device_id]
           if identity is not None}
    if not ids:
        return
    owned = set((await db.execute(select(DiscoveredDevice.id).where(
        DiscoveredDevice.user_id == user_id, DiscoveredDevice.id.in_(ids),
    ))).scalars().all())
    if owned != ids:
        raise HTTPException(status_code=404, detail="Linked device not found")


@router.post("/connections", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_connection(
    conn_data: ConnectionCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Ingest a single network connection observation."""
    await _check_device_ownership(db, current_user.id, [conn_data])
    db_conn = NetworkConnection(
        user_id=current_user.id,
        **conn_data.model_dump(),
    )
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    return db_conn


@router.post("/connections/batch", response_model=list[ConnectionResponse], status_code=status.HTTP_201_CREATED)
async def batch_create_connections(
    connections: list[ConnectionCreate] = Body(..., min_length=1, max_length=1000),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Batch ingest multiple network connections."""
    await _check_device_ownership(db, current_user.id, connections)
    db_conns = []
    for conn_data in connections:
        db_conn = NetworkConnection(
            user_id=current_user.id,
            **conn_data.model_dump(),
        )
        db.add(db_conn)
        db_conns.append(db_conn)
    await db.commit()
    for db_conn in db_conns:
        await db.refresh(db_conn)
    return db_conns


@router.get("/connections", response_model=list[ConnectionResponse])
async def list_connections(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """List all network connections for the current user."""
    result = await db.execute(
        select(NetworkConnection)
        .where(NetworkConnection.user_id == current_user.id)
        .order_by(NetworkConnection.last_seen.desc())
    )
    return result.scalars().all()


_CONNECTION_FIELDS = ("id", "source_device_id", "target_device_id", "source_ip", "target_ip", "protocol",
                      "port", "direction", "first_seen", "last_seen", "bytes_transferred", "is_encrypted")


def _connection_values(connection):
    return {field: getattr(connection, field) for field in _CONNECTION_FIELDS}


def _connection_fingerprint(connection):
    body = json.dumps(_connection_values(connection), default=str, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


@router.get("/connections/{connection_id}/removal-review")
async def review_connection_removal(
    connection_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    connection = (await db.execute(select(NetworkConnection).where(
        NetworkConnection.id == connection_id, NetworkConnection.user_id == current_user.id,
    ))).scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    values = _connection_values(connection)
    values["bytes_transferred"] = (str(connection.bytes_transferred)
                                   if connection.bytes_transferred is not None else None)
    return {"connection": values, "reviewed_fingerprint": _connection_fingerprint(connection),
            "retrieved_at": datetime.now(UTC).isoformat()}


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    connection_id: int,
    reviewed_fingerprint: str | None = Query(None, min_length=64, max_length=64, pattern="^[a-f0-9]{64}$"),
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Remove an owned saved connection, optionally guarded by an exact current-record review."""
    connection = (await db.execute(select(NetworkConnection).where(
        NetworkConnection.id == connection_id, NetworkConnection.user_id == current_user.id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    if reviewed_fingerprint is not None and not hmac.compare_digest(
        reviewed_fingerprint, _connection_fingerprint(connection)
    ):
        raise HTTPException(status_code=409, detail="Connection changed. Reload the removal review.")
    conditions = [NetworkConnection.id == connection_id, NetworkConnection.user_id == current_user.id]
    if reviewed_fingerprint is not None:
        for field, value in _connection_values(connection).items():
            column = getattr(NetworkConnection, field)
            conditions.append(column.is_(None) if value is None else
                              or_(column == value, cast(column, String) == str(value)) if isinstance(value, datetime)
                              else column == value)
    result = await db.execute(delete(NetworkConnection).where(*conditions).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Connection changed. Reload the removal review.")
    await db.commit()


@router.get("/graph", response_model=TopologyGraph)
async def get_topology_graph(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get the full network topology graph (nodes + edges) for visualization."""
    graph = await build_topology_graph(current_user.id, db)
    return graph


@router.get("/stats")
async def get_topology_stats(
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Get connection statistics: total count, by protocol, encrypted vs unencrypted."""
    # Total connections
    total_result = await db.execute(
        select(func.count(NetworkConnection.id))
        .where(NetworkConnection.user_id == current_user.id)
    )
    total = total_result.scalar_one()

    # By protocol
    protocol_result = await db.execute(
        select(NetworkConnection.protocol, func.count(NetworkConnection.id))
        .where(NetworkConnection.user_id == current_user.id)
        .group_by(NetworkConnection.protocol)
    )
    by_protocol = {row[0]: row[1] for row in protocol_result.all()}

    # A missing flag is neither an encrypted nor a cleartext observation.
    flags_result = await db.execute(
        select(NetworkConnection.is_encrypted, func.count(NetworkConnection.id))
        .where(NetworkConnection.user_id == current_user.id)
        .group_by(NetworkConnection.is_encrypted)
    )
    flags = dict(flags_result.all())
    encrypted_count = flags.get(True, 0)

    return {
        "total_connections": total,
        "by_protocol": by_protocol,
        "encrypted": encrypted_count,
        "unencrypted": flags.get(False, 0),
        "encryption_unknown": flags.get(None, 0),
    }
