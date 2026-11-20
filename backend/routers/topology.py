"""
Network Topology router for connection mapping and graph visualization.

Provides endpoints for:
- Ingesting network connections (single and batch)
- Listing connections for a user
- Building the topology graph (nodes + edges)
- Connection statistics (protocol breakdown, encryption status)
"""


from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import func, select
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


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    connection_id: int,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a network connection owned by the current user."""
    result = await db.execute(
        select(NetworkConnection).where(
            NetworkConnection.id == connection_id,
            NetworkConnection.user_id == current_user.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    await db.delete(conn)
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

    # Encrypted vs unencrypted
    encrypted_result = await db.execute(
        select(func.count(NetworkConnection.id))
        .where(
            NetworkConnection.user_id == current_user.id,
            NetworkConnection.is_encrypted.is_(True),
        )
    )
    encrypted_count = encrypted_result.scalar_one()

    return {
        "total_connections": total,
        "by_protocol": by_protocol,
        "encrypted": encrypted_count,
        "unencrypted": total - encrypted_count,
    }
