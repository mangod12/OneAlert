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


CYCLONEDX_WITH_VULNS = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "components": [
        {"bom-ref": "comp-openssl", "name": "openssl", "version": "1.1.1k"},
        {"bom-ref": "comp-zlib", "name": "zlib", "version": "1.2.11"},
        {"name": "no-ref-lib", "version": "0.1"},
    ],
    "vulnerabilities": [
        {"id": "CVE-2022-0778", "affects": [{"ref": "comp-openssl"}]},
        {"id": "CVE-2021-3449", "affects": [{"ref": "comp-openssl"}]},
        {"id": "CVE-2018-25032", "affects": [{"ref": "comp-zlib"}, {"ref": "comp-missing"}]},
    ],
}


class TestSBOMVulnerabilityCrossReference:
    def test_upload_populates_vulnerability_counts(self, client, auth_headers, asset_id):
        """Embedded CycloneDX vulnerabilities flag affected components."""
        upload_resp = client.post(
            "/api/v1/sbom/upload",
            json={"asset_id": asset_id, "sbom_data": CYCLONEDX_WITH_VULNS},
            headers=auth_headers,
        )
        assert upload_resp.status_code == 201
        sbom = upload_resp.json()
        assert sbom["vulnerability_count"] == 3

        components = client.get(
            f"/api/v1/sbom/{sbom['id']}/components", headers=auth_headers
        ).json()
        by_name = {c["name"]: c for c in components}
        assert by_name["openssl"]["has_known_vulnerability"] == 2
        assert by_name["zlib"]["has_known_vulnerability"] == 1
        assert by_name["no-ref-lib"]["has_known_vulnerability"] == 0

    def test_upload_without_vulnerabilities_stays_zero(self, client, auth_headers, asset_id):
        """SBOMs without a vulnerabilities section keep zero counts."""
        upload_resp = client.post(
            "/api/v1/sbom/upload",
            json={"asset_id": asset_id, "sbom_data": CYCLONEDX_SAMPLE},
            headers=auth_headers,
        )
        assert upload_resp.status_code == 201
        assert upload_resp.json()["vulnerability_count"] == 0

    def test_parser_maps_affects_to_refs(self):
        """The parser collects distinct vulnerability IDs per component ref."""
        from backend.services.sbom_service import parse_cyclonedx_vulnerabilities

        result = parse_cyclonedx_vulnerabilities(CYCLONEDX_WITH_VULNS)
        assert result["comp-openssl"] == {"CVE-2022-0778", "CVE-2021-3449"}
        assert result["comp-zlib"] == {"CVE-2018-25032"}
        assert result["comp-missing"] == {"CVE-2018-25032"}
        assert parse_cyclonedx_vulnerabilities({"bomFormat": "CycloneDX"}) == {}


def test_cyclonedx_nested_assemblies_native_cpe_and_license_evidence(client, auth_headers, asset_id):
    document = {
        'bomFormat': 'CycloneDX', 'specVersion': '1.6',
        'components': [{'name': 'gateway-assembly', 'bom-ref': 'root', 'components': [
            {'name': 'crypto-library', 'bom-ref': 'crypto', 'version': '3.0',
             'cpe': 'cpe:2.3:a:vendor:crypto:3.0:*:*:*:*:*:*:*',
             'licenses': [{'expression': '(MIT OR Apache-2.0) AND BSD-3-Clause'}]},
            {'name': 'network-stack', 'bom-ref': 'net', 'licenses': [
                {'license': {'id': 'MIT'}}, {'license': {'name': 'Recorded vendor license'}}]},
        ]}],
        'vulnerabilities': [{'id': 'CVE-2026-1001', 'affects': [{'ref': 'crypto'}]}],
    }
    response = client.post('/api/v1/sbom/upload', headers=auth_headers, json={'asset_id': asset_id, 'sbom_data': document})
    assert response.status_code == 201, response.text
    assert response.json()['component_count'] == 3
    assert response.json()['vulnerability_count'] == 1
    rows = client.get(f"/api/v1/sbom/{response.json()['id']}/components", headers=auth_headers).json()
    by_name = {row['name']: row for row in rows}
    assert by_name['crypto-library']['cpe'] == document['components'][0]['components'][0]['cpe']
    assert by_name['crypto-library']['license'] == '(MIT OR Apache-2.0) AND BSD-3-Clause'
    assert by_name['crypto-library']['has_known_vulnerability'] == 1
    assert by_name['network-stack']['license'] == 'MIT\nRecorded vendor license'
    assert by_name['gateway-assembly']['has_known_vulnerability'] == 0
    import csv
    import io
    exported = client.get(f"/api/v1/sbom/{response.json()['id']}/export", headers=auth_headers)
    evidence = {row['name']: row for row in csv.DictReader(io.StringIO(exported.text))}
    assert evidence['crypto-library']['license'] == '(MIT OR Apache-2.0) AND BSD-3-Clause'
    assert evidence['network-stack']['license'] == 'MIT\nRecorded vendor license'
    assert evidence['crypto-library']['known_vulnerabilities'] == '1'


@pytest.mark.parametrize('document', [
    {'components': {}},
    {'components': ['not an object']},
    {'components': [{'name': 'root', 'components': None}]},
    {'components': [{'name': 'root', 'version': {'unexpected': 'object'}}]},
    {'components': [{'name': 'root', 'licenses': [{'expression': 'MIT'}, {'license': {'id': 'Apache-2.0'}}]}]},
    {'components': [{'name': 'root', 'bom-ref': 'same', 'components': [{'name': 'child', 'bom-ref': 'same'}]}]},
    {'components': [{'name': 'root'}], 'vulnerabilities': [{'id': 'CVE-2026-1001', 'affects': [{'ref': {}}]}]},
])
def test_invalid_cyclonedx_evidence_rejects_upload_atomically(client, auth_headers, asset_id, document):
    before = client.get('/api/v1/sbom/', headers=auth_headers).json()
    response = client.post('/api/v1/sbom/upload', headers=auth_headers, json={
        'asset_id': asset_id, 'sbom_data': {'bomFormat': 'CycloneDX', **document},
    })
    assert response.status_code == 400, response.text
    assert 'Invalid CycloneDX' in response.text
    assert client.get('/api/v1/sbom/', headers=auth_headers).json() == before


def test_cyclonedx_native_cpe_wins_without_mutating_document():
    import copy
    document = {'bomFormat': 'CycloneDX', 'components': [{'name': 'native', 'cpe': 'native-cpe',
                 'externalReferences': [{'type': 'cpe', 'url': 'legacy-cpe'}]}]}
    saved = copy.deepcopy(document)
    assert parse_cyclonedx(document)[0]['cpe'] == 'native-cpe'
    assert document == saved


@pytest.mark.parametrize('document', [
    {'bomFormat': 'unknown'},
    {'specVersion': {}},
    {'components': [{'name': '  '}]},
    {'components': [{'name': 'root', 'supplier': []}]},
    {'components': [{'name': 'root', 'licenses': [{'license': {}}]}]},
    {'components': [{'name': 'root', 'externalReferences': [None]}]},
    {'components': [{'name': 'root', 'hashes': [{'alg': 'SHA-256', 'content': {}}]}]},
    {'vulnerabilities': None},
])
def test_cyclonedx_rejects_invalid_evidence_types(document):
    from backend.services.sbom_service import parse_cyclonedx_vulnerabilities
    data = {'bomFormat': 'CycloneDX', **document}
    with pytest.raises(ValueError):
        parse_cyclonedx(data)
        parse_cyclonedx_vulnerabilities(data)


def test_cyclonedx_assembly_order_and_distinct_vulnerability_counts():
    from backend.services.sbom_service import parse_cyclonedx_vulnerabilities
    data = {'bomFormat': 'CycloneDX', 'components': [
        {'name': 'root', 'components': [{'name': 'child', 'components': [
            {'name': 'leaf', 'bom-ref': 'leaf', 'hashes': [{'alg': 'SHA-256', 'content': 'abc123'}]}
        ]}]}, {'name': 'sibling'},
    ], 'vulnerabilities': [
        {'id': 'CVE-2026-1001', 'affects': [{'ref': 'leaf'}, {'ref': 'leaf'}]},
        {'id': 'CVE-2026-1001', 'affects': [{'ref': 'leaf'}]},
        {'id': 'CVE-2026-1002', 'affects': [{'ref': 'leaf'}]},
        {'id': 'CVE-2026-1003', 'affects': [{'ref': 'unknown-ref'}]},
    ]}
    rows = parse_cyclonedx(data)
    assert [row['name'] for row in rows] == ['root', 'child', 'leaf', 'sibling']
    assert rows[2]['hash_sha256'] == 'abc123'
    assert parse_cyclonedx_vulnerabilities(data) == {
        'leaf': {'CVE-2026-1001', 'CVE-2026-1002'}, 'unknown-ref': {'CVE-2026-1003'},
    }
