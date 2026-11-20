"""Tests for exporting the asset inventory as CSV via GET /api/v1/assets/export."""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_export.db"
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


def _make_asset(client: TestClient, headers, name: str, **kwargs):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    with _TestingSessionLocal() as db:
        db.add(Asset(
            user_id=me.json()["id"],
            name=name,
            asset_type=kwargs.pop("asset_type", "hardware"),
            **kwargs,
        ))
        db.commit()


def _read_csv(resp) -> list[dict]:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert "assets.csv" in resp.headers["content-disposition"]
    return list(csv.DictReader(io.StringIO(resp.text)))


class TestAssetsExport:
    def test_export_returns_csv_with_assets(self, client):
        headers = _register_and_login(client, "analyst@example.com")
        _make_asset(
            client, headers, "plc-line-2", vendor="Siemens", product="S7-1500",
            version="2.9", criticality="critical", is_ot_asset=True,
            network_zone="level-2", primary_protocol="s7comm",
            serial_number="SN-4471", last_known_ip="10.0.4.21",
        )

        rows = _read_csv(client.get("/api/v1/assets/export", headers=headers))
        assert len(rows) == 1
        row = rows[0]
        assert row["name"] == "plc-line-2"
        assert row["vendor"] == "Siemens"
        assert row["product"] == "S7-1500"
        assert row["criticality"] == "critical"
        assert row["is_ot_asset"] == "true"
        assert row["network_zone"] == "level-2"
        assert row["primary_protocol"] == "s7comm"
        assert row["serial_number"] == "SN-4471"
        assert row["last_known_ip"] == "10.0.4.21"
        assert row["created_at"] != ""

    def test_export_respects_filters(self, client):
        headers = _register_and_login(client, "filters@example.com")
        _make_asset(client, headers, "plc-01", criticality="critical", is_ot_asset=True, vendor="Siemens")
        _make_asset(client, headers, "laptop-01", criticality="low", is_ot_asset=False, vendor="Dell")

        rows = _read_csv(client.get("/api/v1/assets/export?criticality=critical", headers=headers))
        assert [r["name"] for r in rows] == ["plc-01"]

        rows = _read_csv(client.get("/api/v1/assets/export?is_ot=false", headers=headers))
        assert [r["name"] for r in rows] == ["laptop-01"]

        rows = _read_csv(client.get("/api/v1/assets/export?vendor=Dell", headers=headers))
        assert [r["name"] for r in rows] == ["laptop-01"]

    def test_export_respects_search(self, client):
        headers = _register_and_login(client, "search@example.com")
        _make_asset(client, headers, "historian-01", product="Wonderware Historian")
        _make_asset(client, headers, "switch-01", product="Cisco IE4000")

        rows = _read_csv(client.get("/api/v1/assets/export?search=historian", headers=headers))
        assert [r["name"] for r in rows] == ["historian-01"]

    def test_export_excludes_other_users_assets(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        _make_asset(client, other, "not-yours")

        rows = _read_csv(client.get("/api/v1/assets/export", headers=owner))
        assert rows == []

    def test_export_empty_is_header_only(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/assets/export", headers=headers)
        assert resp.status_code == 200
        lines = [line for line in resp.text.strip().splitlines() if line]
        assert len(lines) == 1
        assert lines[0].startswith("id,name,asset_type")


@pytest.mark.parametrize("sort", [
    "created_at_desc", "created_at_asc", "name_asc", "name_desc",
    "criticality_desc", "criticality_asc", "risk_desc",
])
def test_export_matches_inventory_order_and_scope(client, sort):
    from datetime import UTC, datetime, timedelta

    from backend.models.alert import Alert

    headers = _register_and_login(client, "order-owner@example.com")
    uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    with _TestingSessionLocal() as db:
        for i, (name, criticality) in enumerate([("Zulu", "low"), ("Alpha", "critical"), ("Middle", "medium")]):
            asset = Asset(user_id=uid, name=name, asset_type="hardware", criticality=criticality,
                          vendor="Included", created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=i))
            db.add(asset)
            db.flush()
            if name == "Zulu":
                db.add(Alert(user_id=uid, asset_id=asset.id, title="Active critical exposure", severity="critical", status="pending"))
        db.add(Asset(user_id=uid, name="Excluded", asset_type="hardware", vendor="Other"))
        db.commit()
    params = {"sort": sort, "vendor": "Included"}
    listed = client.get("/api/v1/assets/", params=params, headers=headers)
    assert listed.status_code == 200, listed.text
    rows = _read_csv(client.get("/api/v1/assets/export", params=params, headers=headers))
    assert [row["id"] for row in rows] == [str(asset["id"]) for asset in listed.json()["assets"]]
    assert len(rows) == 3
    if sort == "risk_desc":
        assert rows[0]["name"] == "Zulu"


def test_asset_export_rejects_unknown_order(client):
    headers = _register_and_login(client, "invalid-order@example.com")
    assert client.get("/api/v1/assets/export?sort=unsupported", headers=headers).status_code == 422
