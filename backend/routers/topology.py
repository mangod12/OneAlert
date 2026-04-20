"""
Network Topology router for connection mapping and graph visualization.

Provides endpoints for:
- Ingesting network connections (single and batch)
- Listing connections for a user
- Building the topology graph (nodes + edges)
- Connection statistics (protocol breakdown, encryption status)
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from backend.database.db import get_async_db
from backend.models.user import User
from backend.models.network_connection import (
    NetworkConnection,
    ConnectionCreate,
    ConnectionResponse,
    TopologyGraph,
)
from backend.services.topology_service import build_topology_graph
from backend.routers.auth import get_active_user

router = APIRouter()


@router.post("/connections", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_connection(
    conn_data: ConnectionCreate,
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Ingest a single network connection observation."""
    db_conn = NetworkConnection(
        user_id=current_user.id,
        **conn_data.model_dump(),
    )
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    return db_conn


@router.post("/connections/batch", response_model=List[ConnectionResponse], status_code=status.HTTP_201_CREATED)
async def batch_create_connections(
    connections: List[ConnectionCreate],
    current_user: User = Depends(get_active_user),
    db: AsyncSession = Depends(get_async_db),
):
    """Batch ingest multiple network connections."""
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


@router.get("/connections", response_model=List[ConnectionResponse])
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
            NetworkConnection.is_encrypted == True,
        )
    )
    encrypted_count = encrypted_result.scalar_one()

    return {
        "total_connections": total,
        "by_protocol": by_protocol,
        "encrypted": encrypted_count,
        "unencrypted": total - encrypted_count,
    }
