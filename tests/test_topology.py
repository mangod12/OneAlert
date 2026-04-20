"""
Tests for Network Topology Mapping functionality (Phase 7).

Tests:
1. Create a single connection
2. Batch create connections
3. List connections
4. Build topology graph (creates devices + connections, verifies nodes and edges)
5. Stats endpoint returns correct protocol counts
6. User isolation (cannot see other user's connections)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.user import User
from backend.models.discovered_device import DiscoveredDevice
from backend.models.network_connection import NetworkConnection
from backend.services.auth_service import get_password_hash


# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_async_db] = override_get_async_db


@pytest.fixture(scope="function")
def client():
    """Create a test client with seeded user."""
    Base.metadata.create_all(bind=engine)

    # Seed a test user
    with TestingSessionLocal() as session:
        user = User(
            email="topo_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Topology Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()

    with TestClient(app) as test_client:
        yield test_client

    # Teardown
    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    """Get auth headers for the test user."""
    login_data = {
        "username": "topo_test@example.com",
        "password": "testpass123",
    }
    response = client.post("/api/v1/auth/login", data=login_data)
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestCreateConnection:
    """Test creating a single network connection."""

    def test_create_connection(self, client, auth_headers):
        """Test creating a single connection returns 201 with correct data."""
        payload = {
            "source_ip": "192.168.1.10",
            "target_ip": "192.168.1.20",
            "protocol": "modbus",
            "port": 502,
            "direction": "bidirectional",
            "is_encrypted": False,
            "bytes_transferred": 1024,
        }
        response = client.post(
            "/api/v1/topology/connections", json=payload, headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["source_ip"] == "192.168.1.10"
        assert data["target_ip"] == "192.168.1.20"
        assert data["protocol"] == "modbus"
        assert data["port"] == 502
        assert data["is_encrypted"] is False
        assert data["bytes_transferred"] == 1024
        assert "id" in data
        assert "first_seen" in data
        assert "last_seen" in data


class TestBatchCreateConnections:
    """Test batch creating network connections."""

    def test_batch_create_connections(self, client, auth_headers):
        """Test batch creating multiple connections returns all of them."""
        payload = [
            {
                "source_ip": "10.0.0.1",
                "target_ip": "10.0.0.2",
                "protocol": "https",
                "port": 443,
                "is_encrypted": True,
            },
            {
                "source_ip": "10.0.0.1",
                "target_ip": "10.0.0.3",
                "protocol": "ssh",
                "port": 22,
                "is_encrypted": True,
            },
            {
                "source_ip": "10.0.0.2",
                "target_ip": "10.0.0.3",
                "protocol": "modbus",
                "port": 502,
                "is_encrypted": False,
            },
        ]
        response = client.post(
            "/api/v1/topology/connections/batch", json=payload, headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert len(data) == 3
        protocols = {c["protocol"] for c in data}
        assert protocols == {"https", "ssh", "modbus"}


class TestListConnections:
    """Test listing connections."""

    def test_list_connections(self, client, auth_headers):
        """Test listing connections returns all user connections."""
        # Create two connections
        for target in ["10.0.0.2", "10.0.0.3"]:
            client.post(
                "/api/v1/topology/connections",
                json={
                    "source_ip": "10.0.0.1",
                    "target_ip": target,
                    "protocol": "modbus",
                    "port": 502,
                },
                headers=auth_headers,
            )

        response = client.get("/api/v1/topology/connections", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_list_connections_empty(self, client, auth_headers):
        """Test listing connections when none exist returns empty list."""
        response = client.get("/api/v1/topology/connections", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []


class TestTopologyGraph:
    """Test building the topology graph."""

    def test_build_topology_graph(self, client, auth_headers):
        """Test graph builds nodes from devices and connections, edges from connections."""
        # Create discovered devices first
        device1 = {
            "ip_address": "192.168.1.10",
            "hostname": "plc-01",
            "manufacturer": "Siemens",
            "is_ot_device": True,
            "discovery_method": "passive_network_scan",
        }
        device2 = {
            "ip_address": "192.168.1.20",
            "hostname": "hmi-01",
            "manufacturer": "Rockwell",
            "is_ot_device": True,
            "discovery_method": "passive_network_scan",
        }
        client.post("/api/v1/ot/discovered-devices", json=device1, headers=auth_headers)
        client.post("/api/v1/ot/discovered-devices", json=device2, headers=auth_headers)

        # Create connections (one between known devices, one to unknown IP)
        conn1 = {
            "source_ip": "192.168.1.10",
            "target_ip": "192.168.1.20",
            "protocol": "modbus",
            "port": 502,
        }
        conn2 = {
            "source_ip": "192.168.1.10",
            "target_ip": "10.0.0.99",
            "protocol": "https",
            "port": 443,
            "is_encrypted": True,
        }
        client.post("/api/v1/topology/connections", json=conn1, headers=auth_headers)
        client.post("/api/v1/topology/connections", json=conn2, headers=auth_headers)

        # Get the graph
        response = client.get("/api/v1/topology/graph", headers=auth_headers)
        assert response.status_code == 200
        graph = response.json()

        # Verify nodes
        assert len(graph["nodes"]) == 3  # 2 devices + 1 unknown IP
        node_ids = {n["id"] for n in graph["nodes"]}
        assert "192.168.1.10" in node_ids
        assert "192.168.1.20" in node_ids
        assert "10.0.0.99" in node_ids

        # Verify device nodes have labels from hostname
        plc_node = next(n for n in graph["nodes"] if n["id"] == "192.168.1.10")
        assert plc_node["label"] == "plc-01"
        assert plc_node["type"] == "ot_device"

        # Unknown IP should have IP as label
        unknown_node = next(n for n in graph["nodes"] if n["id"] == "10.0.0.99")
        assert unknown_node["label"] == "10.0.0.99"
        assert unknown_node["type"] == "unknown"

        # Verify edges
        assert len(graph["edges"]) == 2
        protocols = {e["protocol"] for e in graph["edges"]}
        assert "modbus" in protocols
        assert "https" in protocols


class TestTopologyStats:
    """Test topology statistics endpoint."""

    def test_stats_protocol_counts(self, client, auth_headers):
        """Test stats returns correct protocol breakdown and encryption counts."""
        connections = [
            {"source_ip": "10.0.0.1", "target_ip": "10.0.0.2", "protocol": "modbus", "port": 502, "is_encrypted": False},
            {"source_ip": "10.0.0.1", "target_ip": "10.0.0.3", "protocol": "modbus", "port": 502, "is_encrypted": False},
            {"source_ip": "10.0.0.1", "target_ip": "10.0.0.4", "protocol": "https", "port": 443, "is_encrypted": True},
            {"source_ip": "10.0.0.2", "target_ip": "10.0.0.3", "protocol": "ssh", "port": 22, "is_encrypted": True},
        ]
        client.post(
            "/api/v1/topology/connections/batch", json=connections, headers=auth_headers
        )

        response = client.get("/api/v1/topology/stats", headers=auth_headers)
        assert response.status_code == 200
        stats = response.json()

        assert stats["total_connections"] == 4
        assert stats["by_protocol"]["modbus"] == 2
        assert stats["by_protocol"]["https"] == 1
        assert stats["by_protocol"]["ssh"] == 1
        assert stats["encrypted"] == 2
        assert stats["unencrypted"] == 2

    def test_stats_empty(self, client, auth_headers):
        """Test stats with no connections returns zeros."""
        response = client.get("/api/v1/topology/stats", headers=auth_headers)
        assert response.status_code == 200
        stats = response.json()
        assert stats["total_connections"] == 0
        assert stats["by_protocol"] == {}
        assert stats["encrypted"] == 0
        assert stats["unencrypted"] == 0


class TestUserIsolation:
    """Test that users cannot see other users' connections."""

    def test_cannot_see_other_users_connections(self, client, auth_headers):
        """Test user isolation for connections and stats."""
        # Create connections as first user
        client.post(
            "/api/v1/topology/connections",
            json={
                "source_ip": "10.0.0.1",
                "target_ip": "10.0.0.2",
                "protocol": "modbus",
                "port": 502,
            },
            headers=auth_headers,
        )

        # Verify first user sees the connection
        response = client.get("/api/v1/topology/connections", headers=auth_headers)
        assert len(response.json()) == 1

        # Create second user
        register_data = {
            "email": "other_topo@example.com",
            "password": "otherpass123",
            "full_name": "Other User",
            "company": "Other Corp",
        }
        client.post("/api/v1/auth/register", json=register_data)

        # Login as second user
        login_data = {
            "username": "other_topo@example.com",
            "password": "otherpass123",
        }
        login_resp = client.post("/api/v1/auth/login", data=login_data)
        other_token = login_resp.json()["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        # Second user should see no connections
        response = client.get("/api/v1/topology/connections", headers=other_headers)
        assert response.status_code == 200
        assert response.json() == []

        # Second user stats should show zero
        response = client.get("/api/v1/topology/stats", headers=other_headers)
        assert response.status_code == 200
        assert response.json()["total_connections"] == 0

        # Second user graph should have no edges
        response = client.get("/api/v1/topology/graph", headers=other_headers)
        assert response.status_code == 200
        assert response.json()["edges"] == []
