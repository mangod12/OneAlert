"""Network topology graph construction from connections and devices."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.models.network_connection import NetworkConnection
from backend.models.discovered_device import DiscoveredDevice


async def build_topology_graph(user_id: int, db: AsyncSession) -> dict:
    """Build a graph representation of the network topology.

    Returns nodes (devices/IPs) and edges (connections) suitable for
    frontend visualization (e.g., React Flow or D3.js).
    """
    # Fetch all connections for user
    conn_result = await db.execute(
        select(NetworkConnection).where(NetworkConnection.user_id == user_id)
    )
    connections = conn_result.scalars().all()

    # Fetch all discovered devices for user
    device_result = await db.execute(
        select(DiscoveredDevice).where(DiscoveredDevice.user_id == user_id)
    )
    devices = device_result.scalars().all()

    # Build device lookup by IP
    device_by_ip = {}
    for device in devices:
        if device.ip_address:
            device_by_ip[device.ip_address] = device

    # Build nodes
    nodes = {}
    for device in devices:
        ip = device.ip_address
        nodes[ip] = {
            "id": ip,
            "label": device.hostname or device.manufacturer or ip,
            "type": "ot_device" if device.is_ot_device else "device",
            "zone": None,  # Would come from asset correlation
            "risk_score": device.risk_score or 0,
            "device_id": device.id,
        }

    # Add nodes from connections that aren't in devices
    for conn in connections:
        for ip in [conn.source_ip, conn.target_ip]:
            if ip not in nodes:
                nodes[ip] = {
                    "id": ip,
                    "label": ip,
                    "type": "unknown",
                    "zone": None,
                    "risk_score": 0,
                    "device_id": None,
                }

    # Build edges
    edges = []
    for conn in connections:
        edges.append({
            "source": conn.source_ip,
            "target": conn.target_ip,
            "protocol": conn.protocol,
            "is_encrypted": conn.is_encrypted,
            "port": conn.port,
            "bytes_transferred": conn.bytes_transferred,
        })

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
    }
