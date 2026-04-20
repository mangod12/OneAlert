"""
Tests for FastAPI endpoints and API functionality.
Tests authentication, asset management, and alert APIs.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker # Add async imports
from unittest.mock import patch

from backend.main import app
from backend.database.db import get_db, get_async_db, Base # Import get_async_db
from backend.models.user import User
from backend.models.asset import Asset, AssetType
from backend.models.alert import Alert, AlertStatus, Severity


# Synchronous Test database setup (for schema management and sync override if needed)
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Asynchronous Test database setup (for async endpoint override)
ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test.db" # Same file as sync
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)

# Override for synchronous get_db
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

# Override for asynchronous get_async_db
async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_async_db] = override_get_async_db


@pytest.fixture(scope="function")
def client():
    """Create a test client for the FastAPI app."""
    # Create test tables using the application's Base and the synchronous engine
    Base.metadata.create_all(bind=engine)
    
    with TestClient(app) as test_client:
        yield test_client
    
    # Teardown: Clear data from all tables and then drop them
    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_user_data():
    """Test user data for registration."""
    return {
        "email": "test@example.com",
        "password": "testpassword123",
        "full_name": "Test User",
        "company": "Test Company"
    }


@pytest.fixture
def test_asset_data():
    """Test asset data for creation."""
    return {
        "name": "Test Server",
        "asset_type": "hardware",
        "vendor": "Cisco",
        "product": "ASA 5525-X",
        "version": "9.12",
        "description": "Test firewall device"
    }


class TestAuthenticationAPI:
    """Test cases for authentication endpoints."""
    
    def test_register_user(self, client, test_user_data):
        """Test user registration."""
        response = client.post("/api/v1/auth/register", json=test_user_data)
        
        # Add a print statement to see the response if it's not 201
        if response.status_code != 201:
            print(f"Register user response: {response.status_code} - {response.text}")
            
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == test_user_data["email"]
        assert data["full_name"] == test_user_data["full_name"]
        assert "id" in data
        assert "hashed_password" not in data  # Should not expose password
    
    def test_register_duplicate_email(self, client, test_user_data):
        """Test registration with duplicate email."""
        # Register first user
        client.post("/api/v1/auth/register", json=test_user_data)
        
        # Try to register with same email
        response = client.post("/api/v1/auth/register", json=test_user_data)
        
        assert response.status_code == 400
        body = response.json()
        error_msg = body.get("detail") or body.get("error", {}).get("message", "")
        assert "Email already registered" in error_msg
    
    def test_login_success(self, client, test_user_data):
        """Test successful login."""
        # Register user first
        client.post("/api/v1/auth/register", json=test_user_data)
        
        # Login
        login_data = {
            "username": test_user_data["email"],
            "password": test_user_data["password"]
        }
        response = client.post("/api/v1/auth/login", data=login_data)
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_invalid_credentials(self, client, test_user_data):
        """Test login with invalid credentials."""
        login_data = {
            "username": "nonexistent@example.com",
            "password": "wrongpassword"
        }
        response = client.post("/api/v1/auth/login", data=login_data)
        
        assert response.status_code == 401
        body = response.json()
        error_msg = body.get("detail") or body.get("error", {}).get("message", "")
        assert "Incorrect email or password" in error_msg
    
    def test_get_current_user(self, client, test_user_data):
        """Test getting current user profile."""
        # Register and login
        client.post("/api/v1/auth/register", json=test_user_data)
        login_response = client.post("/api/v1/auth/login", data={
            "username": test_user_data["email"],
            "password": test_user_data["password"]
        })
        
        token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # Get user profile
        response = client.get("/api/v1/auth/me", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user_data["email"]
        assert data["full_name"] == test_user_data["full_name"]
    
    def test_unauthorized_access(self, client):
        """Test accessing protected endpoint without token."""
        response = client.get("/api/v1/auth/me")
        
        assert response.status_code == 401


class TestAssetsAPI:
    """Test cases for asset management endpoints."""
    
    def get_auth_headers(self, client, user_data):
        """Helper to get authentication headers."""
        client.post("/api/v1/auth/register", json=user_data)
        login_response = client.post("/api/v1/auth/login", data={
            "username": user_data["email"],
            "password": user_data["password"]
        })
        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_create_asset(self, client, test_user_data, test_asset_data):
        """Test creating a new asset."""
        headers = self.get_auth_headers(client, test_user_data)
        
        response = client.post("/api/v1/assets/", json=test_asset_data, headers=headers)
        
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == test_asset_data["name"]
        assert data["asset_type"] == test_asset_data["asset_type"]
        assert data["vendor"] == test_asset_data["vendor"]
        assert "id" in data
        assert "user_id" in data
    
    def test_list_assets(self, client, test_user_data, test_asset_data):
        """Test listing user assets."""
        headers = self.get_auth_headers(client, test_user_data)
        
        # Create an asset first
        client.post("/api/v1/assets/", json=test_asset_data, headers=headers)
        
        # List assets
        response = client.get("/api/v1/assets/", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "assets" in data
        assert "total" in data
        assert data["total"] == 1
        assert len(data["assets"]) == 1
        assert data["assets"][0]["name"] == test_asset_data["name"]
        # Add print to see what's being returned
        print(f"List assets response: {data}")
    
    def test_get_asset_by_id(self, client, test_user_data, test_asset_data):
        """Test getting a specific asset by ID."""
        headers = self.get_auth_headers(client, test_user_data)
        
        # Create an asset
        create_response = client.post("/api/v1/assets/", json=test_asset_data, headers=headers)
        asset_id = create_response.json()["id"]
        
        # Get the asset
        response = client.get(f"/api/v1/assets/{asset_id}", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == asset_id
        assert data["name"] == test_asset_data["name"]
    
    def test_update_asset(self, client, test_user_data, test_asset_data):
        """Test updating an existing asset."""
        headers = self.get_auth_headers(client, test_user_data)
        
        # Create an asset
        create_response = client.post("/api/v1/assets/", json=test_asset_data, headers=headers)
        asset_id = create_response.json()["id"]
        
        # Update the asset
        update_data = {"name": "Updated Server Name", "version": "9.13"}
        response = client.put(f"/api/v1/assets/{asset_id}", json=update_data, headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Server Name"
        assert data["version"] == "9.13"
        assert data["vendor"] == test_asset_data["vendor"]  # Unchanged
    
    def test_delete_asset(self, client, test_user_data, test_asset_data):
        """Test deleting an asset."""
        headers = self.get_auth_headers(client, test_user_data)
        
        # Create an asset
        create_response = client.post("/api/v1/assets/", json=test_asset_data, headers=headers)
        asset_id = create_response.json()["id"]
        
        # Delete the asset
        response = client.delete(f"/api/v1/assets/{asset_id}", headers=headers)
        
        assert response.status_code == 204
        
        # Verify asset is deleted
        get_response = client.get(f"/api/v1/assets/{asset_id}", headers=headers)
        assert get_response.status_code == 404
    
    def test_get_asset_types(self, client, test_user_data):
        """Test getting available asset types."""
        response = client.get("/api/v1/assets/types/")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert "hardware" in data
        assert "software" in data
        assert "firmware" in data
        assert "operating_system" in data
    
    def test_asset_filtering(self, client, test_user_data):
        """Test asset filtering by type and vendor."""
        headers = self.get_auth_headers(client, test_user_data)
        
        # Create multiple assets
        assets_to_create = [
            {"name": "Cisco Router", "asset_type": "hardware", "vendor": "Cisco", "product": "ASR1000", "version": "1.0"},
            {"name": "Apache Server", "asset_type": "software", "vendor": "Apache", "product": "HTTPD", "version": "2.4"},
            {"name": "Cisco Switch", "asset_type": "hardware", "vendor": "Cisco", "product": "Catalyst 9000", "version": "17.3"}
        ]
        
        for asset in assets_to_create:
            # Ensure all required fields for AssetCreate are present
            full_asset_data = {
                "description": "Test asset", 
                **asset  # Merge with the minimal data
            }
            create_response = client.post("/api/v1/assets/", json=full_asset_data, headers=headers)
            assert create_response.status_code == 201, f"Failed to create asset: {create_response.json()}"

        # Get all assets for this user to see the total count
        response_all = client.get("/api/v1/assets/", headers=headers)
        assert response_all.status_code == 200
        data_all = response_all.json()
        print(f"Total assets for user before filtering: {data_all['total']}")
        print(f"Assets returned before filtering: {data_all['assets']}")

        # Filter by vendor
        response_vendor = client.get("/api/v1/assets/?vendor=Cisco", headers=headers)
        assert response_vendor.status_code == 200
        data_vendor = response_vendor.json()
        print(f"Assets returned for vendor=Cisco: {data_vendor['assets']}")
        assert data_vendor["total"] == 2, f"Expected 2 Cisco assets, got {data_vendor['total']}. All assets: {data_all['assets']}"
        
        # Filter by asset type
        response_type = client.get("/api/v1/assets/?asset_type=hardware", headers=headers)
        assert response_type.status_code == 200
        data_type = response_type.json()
        print(f"Assets returned for asset_type=hardware: {data_type['assets']}")
        assert data_type["total"] == 2, f"Expected 2 hardware assets, got {data_type['total']}"
        
        # Combined filter
        response_combined = client.get("/api/v1/assets/?asset_type=hardware&vendor=Cisco", headers=headers)
        assert response_combined.status_code == 200
        data_combined = response_combined.json()
        print(f"Assets returned for asset_type=hardware&vendor=Cisco: {data_combined['assets']}")
        assert data_combined["total"] == 2, f"Expected 2 hardware Cisco assets, got {data_combined['total']}"

class TestAlertsAPI:
    """Test cases for alert endpoints."""
    
    def get_auth_headers(self, client, user_data):
        """Helper to get authentication headers."""
        client.post("/api/v1/auth/register", json=user_data)
        login_response = client.post("/api/v1/auth/login", data={
            "username": user_data["email"],
            "password": user_data["password"]
        })
        token = login_response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    
    def test_list_alerts_empty(self, client, test_user_data):
        """Test listing alerts when none exist."""
        headers = self.get_auth_headers(client, test_user_data)
        
        response = client.get("/api/v1/alerts/", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "alerts" in data
        assert data["total"] == 0
        assert len(data["alerts"]) == 0
    
    def test_get_alert_stats(self, client, test_user_data):
        """Test getting alert statistics."""
        headers = self.get_auth_headers(client, test_user_data)
        
        response = client.get("/api/v1/alerts/stats/overview", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "total_alerts" in data
        assert "critical_alerts" in data
        assert "high_alerts" in data
        assert "medium_alerts" in data
        assert "low_alerts" in data
        assert "pending_alerts" in data
        assert "acknowledged_alerts" in data
        
        # Should be zero for new user
        assert data["total_alerts"] == 0


class TestHealthAndRoot:
    """Test cases for health check and root endpoints."""
    
    def test_health_check(self, client):
        """Test health check endpoint."""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "app_name" in data
        assert "version" in data
    
    def test_root_endpoint(self, client):
        """Test root endpoint redirects to frontend."""
        response = client.get("/", follow_redirects=False)
        
        assert response.status_code == 307  # Redirect
        assert response.headers["location"] == "/app/"


@pytest.mark.asyncio
async def test_api_integration(client, test_user_data, test_asset_data):
    """Integration test for the entire API."""
    with TestClient(app) as client:
        # Test that the app starts without errors
        response = client.get("/health")
        assert response.status_code == 200
        
        # Test that docs are accessible
        response = client.get("/docs")
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__])