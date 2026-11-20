"""Tests for exporting SBOM components as CSV via GET /api/v1/sbom/{id}/export."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_sbom_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_sbom_export.db"
_async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_AsyncTestingSessionLocal = async_sessionmaker(
    bind=_async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def _override_get_db():
    try:
        db = _TestingSessionLocal()
        yield db
    finally:
        db.close()


async def _override_get_async_db():
    async with _AsyncTestingSessionLocal() as session:
        yield session


@pytest.fixture
def client():
    """Create a test client with fresh database tables."""
    Base.metadata.create_all(bind=_engine)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _make_sbom(client: TestClient, headers, components: list[dict]) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        sbom = SBOM(
            asset_id=asset.id, user_id=uid, format="CycloneDX",
            component_count=len(components),
            vulnerability_count=sum(c.get("has_known_vulnerability", 0) for c in components),
        )
        db.add(sbom)
        db.commit()
        db.refresh(sbom)
        for c in components:
            db.add(SBOMComponent(sbom_id=sbom.id, **c))
        db.commit()
        return sbom.id


def _read_csv(resp) -> list[dict]:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    return list(csv.DictReader(io.StringIO(resp.text)))


class TestSbomExport:
    def test_export_returns_components_sorted_by_name(self, client):
        headers = _register_and_login(client, "analyst@example.com")
        sbom_id = _make_sbom(client, headers, [
            {"name": "openssl", "version": "3.0.2", "supplier": "OpenSSL Project",
             "purl": "pkg:deb/debian/openssl@3.0.2", "license": "Apache-2.0",
             "has_known_vulnerability": 2},
            {"name": "busybox", "version": "1.35.0", "has_known_vulnerability": 0},
        ])

        resp = client.get(f"/api/v1/sbom/{sbom_id}/export", headers=headers)
        assert f"sbom-{sbom_id}-components.csv" in resp.headers["content-disposition"]
        rows = _read_csv(resp)
        assert [r["name"] for r in rows] == ["busybox", "openssl"]
        assert rows[1]["version"] == "3.0.2"
        assert rows[1]["purl"] == "pkg:deb/debian/openssl@3.0.2"
        assert rows[1]["license"] == "Apache-2.0"
        assert rows[1]["known_vulnerabilities"] == "2"
        assert rows[0]["known_vulnerabilities"] == "0"

    def test_export_other_users_sbom_404(self, client):
        owner = _register_and_login(client, "owner@example.com")
        intruder = _register_and_login(client, "intruder@example.com")
        sbom_id = _make_sbom(client, owner, [{"name": "openssl"}])

        resp = client.get(f"/api/v1/sbom/{sbom_id}/export", headers=intruder)
        assert resp.status_code == 404

    def test_export_missing_sbom_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        resp = client.get("/api/v1/sbom/99999/export", headers=headers)
        assert resp.status_code == 404


@pytest.mark.parametrize('value', ['=1+1', '+cmd', '-1+2', '@SUM(1)', '  =1', '\t+cmd', '\r@cmd', '\n-cmd'])
def test_export_neutralizes_formula_like_component_text(client, value):
    headers = _register_and_login(client, "csv-text@example.com")
    fields = ["name", "version", "supplier", "purl", "cpe", "license", "hash_sha256"]
    sbom_id = _make_sbom(client, headers, [{**{field: value for field in fields}, "has_known_vulnerability": 0}])
    rows = _read_csv(client.get(f"/api/v1/sbom/{sbom_id}/export", headers=headers))
    assert len(rows) == 1
    assert all(rows[0][field] == "'" + value for field in fields)
    assert rows[0]["known_vulnerabilities"] == "0"
    # CSV protection is presentation-only, never a stored evidence rewrite.
    components = client.get(f"/api/v1/sbom/{sbom_id}/components", headers=headers).json()
    assert all(components[0][field] == value for field in fields)


def test_export_preserves_normal_text_commas_quotes_and_null_fields(client):
    headers = _register_and_login(client, "csv-normal@example.com")
    sbom_id = _make_sbom(client, headers, [{"name": 'lib, "special"', "license": "Apache-2.0", "has_known_vulnerability": 2}])
    rows = _read_csv(client.get(f"/api/v1/sbom/{sbom_id}/export", headers=headers))
    assert rows == [{"name": 'lib, "special"', "version": "", "supplier": "", "purl": "", "cpe": "", "license": "Apache-2.0", "hash_sha256": "", "known_vulnerabilities": "2"}]
