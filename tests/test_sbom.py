"""
Tests for SBOM (Software Bill of Materials) functionality (Phase 6).

Tests:
1. Upload CycloneDX SBOM - parses components correctly
2. Upload SPDX SBOM - parses components correctly
3. List user's SBOMs
4. Get SBOM components
5. Delete SBOM (cascades to components)
6. Cannot access another user's SBOM (returns 404)
7. Parser edge cases (empty components, missing fields)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent
from backend.services.auth_service import get_password_hash
from backend.services.sbom_service import parse_cyclonedx, parse_spdx


# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_sbom.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_sbom.db"
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




# Sample SBOM data
CYCLONEDX_SAMPLE = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "components": [
        {
            "name": "openssl",
            "version": "1.1.1k",
            "purl": "pkg:generic/openssl@1.1.1k",
            "licenses": [{"license": {"id": "Apache-2.0"}}],
        },
        {
            "name": "libcurl",
            "version": "7.79.1",
            "supplier": {"name": "curl"},
            "hashes": [{"alg": "SHA-256", "content": "abc123def456"}],
        },
    ],
}

SPDX_SAMPLE = {
    "spdxVersion": "SPDX-2.3",
    "packages": [
        {
            "name": "busybox",
            "versionInfo": "1.35.0",
            "licenseConcluded": "GPL-2.0-only",
            "externalRefs": [
                {
                    "referenceType": "purl",
                    "referenceLocator": "pkg:generic/busybox@1.35.0",
                }
            ],
        },
        {
            "name": "zlib",
            "versionInfo": "1.2.11",
            "supplier": "NOASSERTION",
            "licenseConcluded": "NOASSERTION",
            "checksums": [
                {"algorithm": "SHA256", "checksumValue": "deadbeef1234"}
            ],
        },
    ],
}


@pytest.fixture(scope="function")
def client():
    """Create a test client with seeded user and asset."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    # Seed a test user and an asset
    with TestingSessionLocal() as session:
        user = User(
            email="sbom_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="SBOM Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        asset = Asset(
            user_id=user.id,
            name="Test PLC",
            asset_type="plc",
            vendor="Siemens",
            product="S7-1500",
            version="2.9",
        )
        session.add(asset)
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
        "username": "sbom_test@example.com",
        "password": "testpass123",
    }
    response = client.post("/api/v1/auth/login", data=login_data)
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def asset_id(client, auth_headers):
    """Get the asset ID for the test asset."""
    response = client.get("/api/v1/assets/", headers=auth_headers)
    assert response.status_code == 200
    assets = response.json()["assets"]
    assert len(assets) > 0
    return assets[0]["id"]


class TestSBOMUpload:
    """Test SBOM upload functionality."""

    def test_upload_cyclonedx(self, client, auth_headers, asset_id):
        """Test uploading a CycloneDX SBOM parses components correctly."""
        payload = {
            "asset_id": asset_id,
            "sbom_data": CYCLONEDX_SAMPLE,
            "source": "upload",
        }
        response = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["format"] == "CycloneDX"
        assert data["version"] == "1.5"
        assert data["source"] == "upload"
        assert data["component_count"] == 2
        assert data["asset_id"] == asset_id

    def test_upload_spdx(self, client, auth_headers, asset_id):
        """Test uploading an SPDX SBOM parses components correctly."""
        payload = {
            "asset_id": asset_id,
            "sbom_data": SPDX_SAMPLE,
            "source": "vendor_provided",
        }
        response = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        assert response.status_code == 201
        data = response.json()
        assert data["format"] == "SPDX"
        assert data["version"] == "SPDX-2.3"
        assert data["source"] == "vendor_provided"
        assert data["component_count"] == 2

    def test_upload_unsupported_format(self, client, auth_headers, asset_id):
        """Test uploading an unsupported SBOM format returns 400."""
        payload = {
            "asset_id": asset_id,
            "sbom_data": {"unknown": "format"},
        }
        response = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        assert response.status_code == 400

    def test_upload_nonexistent_asset(self, client, auth_headers):
        """Test uploading to a non-existent asset returns 404."""
        payload = {
            "asset_id": 9999,
            "sbom_data": CYCLONEDX_SAMPLE,
        }
        response = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        assert response.status_code == 404


class TestSBOMList:
    """Test listing SBOMs."""

    def test_list_user_sboms(self, client, auth_headers, asset_id):
        """Test listing all SBOMs for current user."""
        # Upload two SBOMs
        payload1 = {"asset_id": asset_id, "sbom_data": CYCLONEDX_SAMPLE}
        payload2 = {"asset_id": asset_id, "sbom_data": SPDX_SAMPLE}
        client.post("/api/v1/sbom/upload", json=payload1, headers=auth_headers)
        client.post("/api/v1/sbom/upload", json=payload2, headers=auth_headers)

        response = client.get("/api/v1/sbom/", headers=auth_headers)
        assert response.status_code == 200
        sboms = response.json()
        assert len(sboms) == 2

    def test_list_empty(self, client, auth_headers):
        """Test listing SBOMs when none exist returns empty list."""
        response = client.get("/api/v1/sbom/", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []


class TestSBOMComponents:
    """Test SBOM component retrieval."""

    def test_get_sbom_components(self, client, auth_headers, asset_id):
        """Test retrieving components of an SBOM."""
        # Upload an SBOM
        payload = {"asset_id": asset_id, "sbom_data": CYCLONEDX_SAMPLE}
        upload_resp = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        sbom_id = upload_resp.json()["id"]

        # Get components
        response = client.get(
            f"/api/v1/sbom/{sbom_id}/components", headers=auth_headers
        )
        assert response.status_code == 200
        components = response.json()
        assert len(components) == 2

        # Verify component details
        names = {c["name"] for c in components}
        assert "openssl" in names
        assert "libcurl" in names

        # Verify openssl details
        openssl = next(c for c in components if c["name"] == "openssl")
        assert openssl["version"] == "1.1.1k"
        assert openssl["purl"] == "pkg:generic/openssl@1.1.1k"
        assert openssl["license"] == "Apache-2.0"

        # Verify libcurl details
        libcurl = next(c for c in components if c["name"] == "libcurl")
        assert libcurl["version"] == "7.79.1"
        assert libcurl["supplier"] == "curl"
        assert libcurl["has_known_vulnerability"] == 0

    def test_get_components_nonexistent_sbom(self, client, auth_headers):
        """Test getting components of a non-existent SBOM returns 404."""
        response = client.get(
            "/api/v1/sbom/9999/components", headers=auth_headers
        )
        assert response.status_code == 404


class TestSBOMDelete:
    """Test SBOM deletion."""

    def test_delete_sbom_cascades(self, client, auth_headers, asset_id):
        """Test deleting an SBOM removes it and its components."""
        # Upload an SBOM
        payload = {"asset_id": asset_id, "sbom_data": CYCLONEDX_SAMPLE}
        upload_resp = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        sbom_id = upload_resp.json()["id"]

        # Delete
        response = client.delete(
            f"/api/v1/sbom/{sbom_id}", headers=auth_headers
        )
        assert response.status_code == 204

        # Verify SBOM is gone
        response = client.get(
            f"/api/v1/sbom/{sbom_id}", headers=auth_headers
        )
        assert response.status_code == 404

        # Verify components are gone
        response = client.get(
            f"/api/v1/sbom/{sbom_id}/components", headers=auth_headers
        )
        assert response.status_code == 404

    def test_delete_nonexistent_sbom(self, client, auth_headers):
        """Test deleting a non-existent SBOM returns 404."""
        response = client.delete(
            "/api/v1/sbom/9999", headers=auth_headers
        )
        assert response.status_code == 404


class TestSBOMAccessControl:
    """Test SBOM access control between users."""

    def test_cannot_access_other_users_sbom(self, client, auth_headers, asset_id):
        """Test that a user cannot access another user's SBOM."""
        # Upload SBOM as first user
        payload = {"asset_id": asset_id, "sbom_data": CYCLONEDX_SAMPLE}
        upload_resp = client.post(
            "/api/v1/sbom/upload", json=payload, headers=auth_headers
        )
        sbom_id = upload_resp.json()["id"]

        # Create a second user
        register_data = {
            "email": "other_user@example.com",
            "password": "otherpass123",
            "full_name": "Other User",
            "company": "Other Corp",
        }
        client.post("/api/v1/auth/register", json=register_data)

        # Login as second user
        login_data = {
            "username": "other_user@example.com",
            "password": "otherpass123",
        }
        login_resp = client.post("/api/v1/auth/login", data=login_data)
        other_token = login_resp.json()["access_token"]
        other_headers = {"Authorization": f"Bearer {other_token}"}

        # Try to access first user's SBOM
        response = client.get(
            f"/api/v1/sbom/{sbom_id}", headers=other_headers
        )
        assert response.status_code == 404

        # Try to delete first user's SBOM
        response = client.delete(
            f"/api/v1/sbom/{sbom_id}", headers=other_headers
        )
        assert response.status_code == 404


class TestSBOMParsers:
    """Test SBOM parser edge cases."""

    def test_parse_cyclonedx_empty_components(self):
        """Test parsing CycloneDX with empty components list."""
        data = {"bomFormat": "CycloneDX", "specVersion": "1.5", "components": []}
        result = parse_cyclonedx(data)
        assert result == []

    def test_parse_cyclonedx_missing_components_key(self):
        """Test parsing CycloneDX with no components key."""
        data = {"bomFormat": "CycloneDX", "specVersion": "1.5"}
        result = parse_cyclonedx(data)
        assert result == []

    def test_parse_cyclonedx_minimal_component(self):
        """Test parsing CycloneDX with minimal component data."""
        data = {
            "bomFormat": "CycloneDX",
            "components": [{"name": "minimal"}],
        }
        result = parse_cyclonedx(data)
        assert len(result) == 1
        assert result[0]["name"] == "minimal"
        assert result[0]["version"] == ""
        assert result[0]["supplier"] is None
        assert result[0]["purl"] == ""
        assert result[0]["license"] == ""

    def test_parse_spdx_empty_packages(self):
        """Test parsing SPDX with empty packages list."""
        data = {"spdxVersion": "SPDX-2.3", "packages": []}
        result = parse_spdx(data)
        assert result == []

    def test_parse_spdx_missing_packages_key(self):
        """Test parsing SPDX with no packages key."""
        data = {"spdxVersion": "SPDX-2.3"}
        result = parse_spdx(data)
        assert result == []

    def test_parse_spdx_noassertion_fields(self):
        """Test that NOASSERTION values are normalized to None."""
        data = {
            "spdxVersion": "SPDX-2.3",
            "packages": [
                {
                    "name": "test-pkg",
                    "versionInfo": "1.0",
                    "supplier": "NOASSERTION",
                    "licenseConcluded": "NOASSERTION",
                }
            ],
        }
        result = parse_spdx(data)
        assert len(result) == 1
        assert result[0]["supplier"] is None
        assert result[0]["license"] is None

    def test_parse_cyclonedx_with_cpe(self):
        """Test parsing CycloneDX component with CPE external reference."""
        data = {
            "bomFormat": "CycloneDX",
            "components": [
                {
                    "name": "nginx",
                    "version": "1.21.0",
                    "externalReferences": [
                        {"type": "cpe", "url": "cpe:2.3:a:nginx:nginx:1.21.0"}
                    ],
                }
            ],
        }
        result = parse_cyclonedx(data)
        assert result[0]["cpe"] == "cpe:2.3:a:nginx:nginx:1.21.0"

    def test_parse_spdx_with_cpe(self):
        """Test parsing SPDX package with CPE external reference."""
        data = {
            "spdxVersion": "SPDX-2.3",
            "packages": [
                {
                    "name": "nginx",
                    "versionInfo": "1.21.0",
                    "externalRefs": [
                        {
                            "referenceType": "cpe23Type",
                            "referenceLocator": "cpe:2.3:a:nginx:nginx:1.21.0",
                        }
                    ],
                }
            ],
        }
        result = parse_spdx(data)
        assert result[0]["cpe"] == "cpe:2.3:a:nginx:nginx:1.21.0"
