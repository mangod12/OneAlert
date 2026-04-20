"""
Tests for SIEM/SOAR Integration Suite (Phase 9).
All integration HTTP calls are mocked — never calls real external APIs.
"""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base


# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_integrations.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_integrations.db"
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


@pytest.fixture(scope="function")
def client():
    """Create a test client with fresh database tables."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db

    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    """Register and login a user, return auth headers."""
    user_data = {
        "email": "integrations@test.com",
        "password": "testpassword123",
        "full_name": "Integration Tester",
        "company": "Test Corp",
    }
    client.post("/api/v1/auth/register", json=user_data)
    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": user_data["email"], "password": user_data["password"]},
    )
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestIntegrationTypes:
    """Test listing available integration types."""

    def test_list_integration_types(self, client, auth_headers):
        """Test that we can list all available integration types."""
        response = client.get("/api/v1/integrations/types", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        types = data["data"]
        assert len(types) == 4
        type_ids = [t["type"] for t in types]
        assert "splunk" in type_ids
        assert "sentinel" in type_ids
        assert "servicenow" in type_ids
        assert "pagerduty" in type_ids


class TestIntegrationCRUD:
    """Test CRUD operations for integration configs."""

    def test_create_splunk_integration(self, client, auth_headers):
        """Test creating a Splunk integration config."""
        payload = {
            "integration_type": "splunk",
            "name": "Production Splunk",
            "config": {
                "hec_url": "https://splunk.example.com:8088",
                "hec_token": "test-token-123",
                "index": "security",
            },
        }
        response = client.post(
            "/api/v1/integrations/", json=payload, headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["data"]["integration_type"] == "splunk"
        assert data["data"]["name"] == "Production Splunk"
        assert data["data"]["is_active"] is True
        assert "id" in data["data"]

    def test_create_invalid_type(self, client, auth_headers):
        """Test creating an integration with invalid type."""
        payload = {
            "integration_type": "invalid_type",
            "name": "Invalid",
            "config": {},
        }
        response = client.post(
            "/api/v1/integrations/", json=payload, headers=auth_headers
        )
        assert response.status_code == 400

    def test_list_user_integrations(self, client, auth_headers):
        """Test listing user's integration configurations."""
        # Create two integrations
        for name, itype in [("Splunk Prod", "splunk"), ("PagerDuty", "pagerduty")]:
            client.post(
                "/api/v1/integrations/",
                json={"integration_type": itype, "name": name, "config": {}},
                headers=auth_headers,
            )

        response = client.get("/api/v1/integrations/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]) == 2

    def test_update_integration(self, client, auth_headers):
        """Test updating an integration configuration."""
        # Create
        create_resp = client.post(
            "/api/v1/integrations/",
            json={
                "integration_type": "splunk",
                "name": "Old Name",
                "config": {"hec_url": "https://old.example.com"},
            },
            headers=auth_headers,
        )
        integration_id = create_resp.json()["data"]["id"]

        # Update
        response = client.patch(
            f"/api/v1/integrations/{integration_id}",
            json={"name": "New Name", "is_active": False},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["name"] == "New Name"
        assert data["data"]["is_active"] is False

    def test_delete_integration(self, client, auth_headers):
        """Test deleting an integration configuration."""
        # Create
        create_resp = client.post(
            "/api/v1/integrations/",
            json={
                "integration_type": "pagerduty",
                "name": "To Delete",
                "config": {"routing_key": "abc"},
            },
            headers=auth_headers,
        )
        integration_id = create_resp.json()["data"]["id"]

        # Delete
        response = client.delete(
            f"/api/v1/integrations/{integration_id}", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify gone
        list_resp = client.get("/api/v1/integrations/", headers=auth_headers)
        assert len(list_resp.json()["data"]) == 0


class TestIntegrationConnection:
    """Test connection testing endpoint with mocked HTTP calls."""

    def test_test_connection_pagerduty_configured(self, client, auth_headers):
        """Test connection for PagerDuty with routing key configured."""
        create_resp = client.post(
            "/api/v1/integrations/",
            json={
                "integration_type": "pagerduty",
                "name": "PD Test",
                "config": {"routing_key": "test-key-123"},
            },
            headers=auth_headers,
        )
        integration_id = create_resp.json()["data"]["id"]

        response = client.post(
            f"/api/v1/integrations/{integration_id}/test", headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert "Routing key configured" in data["data"]["message"]

    def test_test_connection_not_found(self, client, auth_headers):
        """Test connection for non-existent integration."""
        response = client.post(
            "/api/v1/integrations/9999/test", headers=auth_headers
        )
        assert response.status_code == 404


class TestIntegrationClasses:
    """Test integration classes return correct error when not configured."""

    @pytest.mark.asyncio
    async def test_splunk_not_configured(self):
        """Splunk returns error when HEC is not configured."""
        from backend.services.integrations.splunk import SplunkIntegration

        integration = SplunkIntegration({})
        result = await integration.send_alert({"title": "Test"})
        assert result["success"] is False
        assert "not configured" in result["error"]

        result = await integration.test_connection()
        assert result["success"] is False
        assert "not configured" in result["error"]

    @pytest.mark.asyncio
    async def test_sentinel_not_configured(self):
        """Sentinel returns error when credentials are missing."""
        from backend.services.integrations.sentinel import SentinelIntegration

        integration = SentinelIntegration({})
        result = await integration.send_alert({"title": "Test"})
        assert result["success"] is False
        assert "not configured" in result["error"]

        result = await integration.test_connection()
        assert result["success"] is False
        assert "not configured" in result["error"]

    @pytest.mark.asyncio
    async def test_servicenow_not_configured(self):
        """ServiceNow returns error when not configured."""
        from backend.services.integrations.servicenow import ServiceNowIntegration

        integration = ServiceNowIntegration({})
        result = await integration.send_alert({"title": "Test"})
        assert result["success"] is False
        assert "not configured" in result["error"]

        result = await integration.test_connection()
        assert result["success"] is False
        assert "not configured" in result["error"]

    @pytest.mark.asyncio
    async def test_pagerduty_not_configured(self):
        """PagerDuty returns error when routing key is missing."""
        from backend.services.integrations.pagerduty import PagerDutyIntegration

        integration = PagerDutyIntegration({})
        result = await integration.send_alert({"title": "Test"})
        assert result["success"] is False
        assert "not configured" in result["error"]

        result = await integration.test_connection()
        assert result["success"] is False
        assert "not configured" in result["error"]

    @pytest.mark.asyncio
    async def test_splunk_send_alert_mocked(self):
        """Test Splunk send_alert with mocked HTTP call."""
        from backend.services.integrations.splunk import SplunkIntegration
        import httpx

        integration = SplunkIntegration({
            "hec_url": "https://splunk.example.com:8088",
            "hec_token": "test-token",
            "index": "security",
        })

        mock_response = httpx.Response(200, json={"text": "Success", "code": 0})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            result = await integration.send_alert({"title": "CVE-2024-1234", "severity": "critical"})
            assert result["success"] is True
            assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_servicenow_send_alert_mocked(self):
        """Test ServiceNow send_alert with mocked HTTP call."""
        from backend.services.integrations.servicenow import ServiceNowIntegration
        import httpx

        integration = ServiceNowIntegration({
            "instance_url": "https://dev12345.service-now.com",
            "username": "admin",
            "password": "secret",
        })

        mock_response = httpx.Response(201, json={"result": {"sys_id": "abc123"}})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            result = await integration.send_alert({
                "title": "Critical Vuln",
                "severity": "critical",
                "description": "Test description",
            })
            assert result["success"] is True
            assert result["status_code"] == 201
