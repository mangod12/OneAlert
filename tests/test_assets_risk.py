"""Tests for risk_score / risk_level on GET /api/v1/assets/ and the risk_desc sort."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_risk.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_risk.db"
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


@pytest.fixture(scope="function")
def client():
    """Create a test client with fresh database tables."""
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db

    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=_engine)


def _register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    reg = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": password,
        "full_name": f"User {email.split('@')[0]}",
        "company": "TestCorp",
    })
    assert reg.status_code == 201, f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email,
        "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _make_asset(user_id: int, name: str, criticality: str = "medium") -> int:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name=name, asset_type="hardware", criticality=criticality)
        db.add(asset)
        db.commit()
        return asset.id


def _make_alert(user_id: int, asset_id: int, title: str, severity: str, status: str = "pending"):
    with _TestingSessionLocal() as db:
        db.add(Alert(
            user_id=user_id,
            asset_id=asset_id,
            title=title,
            description="test alert",
            severity=severity,
            status=status,
        ))
        db.commit()


def _assets_by_name(client: TestClient, headers, **params) -> dict[str, dict]:
    resp = client.get("/api/v1/assets/", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return {a["name"]: a for a in resp.json()["assets"]}


class TestAssetRiskScore:
    def test_severity_weights_and_criticality_multiplier(self, client):
        headers = _register_and_login(client, "risk-weights@example.com")
        uid = _user_id(client, headers)
        # 1 critical (10) + 1 high (5) = base 15; medium criticality x1.0 -> 15
        a1 = _make_asset(uid, "plc-01", "medium")
        _make_alert(uid, a1, "a1", "critical")
        _make_alert(uid, a1, "a2", "high")
        # same base 15 on a critical asset -> x2.0 -> 30
        a2 = _make_asset(uid, "historian-01", "critical")
        _make_alert(uid, a2, "b1", "critical")
        _make_alert(uid, a2, "b2", "high")

        assets = _assets_by_name(client, headers)
        assert assets["plc-01"]["risk_score"] == 15
        assert assets["plc-01"]["risk_level"] == "high"
        assert assets["historian-01"]["risk_score"] == 30
        assert assets["historian-01"]["risk_level"] == "high"

    def test_level_bands(self, client):
        headers = _register_and_login(client, "risk-bands@example.com")
        uid = _user_id(client, headers)
        quiet = _make_asset(uid, "quiet", "medium")
        low = _make_asset(uid, "low-risk", "medium")
        _make_alert(uid, low, "l1", "low")  # base 1 -> low
        medium = _make_asset(uid, "medium-risk", "medium")
        _make_alert(uid, medium, "m1", "high")  # base 5 -> medium
        crit = _make_asset(uid, "crit-risk", "critical")
        for i in range(4):
            _make_alert(uid, crit, f"c{i}", "critical")  # base 40 x2.0 -> 80 (>= 40 -> critical)

        assets = _assets_by_name(client, headers)
        assert assets["quiet"]["risk_score"] == 0
        assert assets["quiet"]["risk_level"] == "none"
        assert assets["low-risk"]["risk_level"] == "low"
        assert assets["medium-risk"]["risk_level"] == "medium"
        assert assets["crit-risk"]["risk_score"] == 80
        assert assets["crit-risk"]["risk_level"] == "critical"

    def test_resolved_alerts_do_not_count(self, client):
        headers = _register_and_login(client, "risk-resolved@example.com")
        uid = _user_id(client, headers)
        asset_id = _make_asset(uid, "patched", "critical")
        _make_alert(uid, asset_id, "old", "critical", status="resolved")

        assets = _assets_by_name(client, headers)
        assert assets["patched"]["risk_score"] == 0
        assert assets["patched"]["risk_level"] == "none"

    def test_risk_sort_orders_descending(self, client):
        headers = _register_and_login(client, "risk-sort@example.com")
        uid = _user_id(client, headers)
        a = _make_asset(uid, "alpha", "medium")
        b = _make_asset(uid, "bravo", "medium")
        c = _make_asset(uid, "charlie", "medium")
        _make_alert(uid, b, "b1", "critical")  # 10
        _make_alert(uid, c, "c1", "critical")  # 10
        _make_alert(uid, c, "c2", "high")  # +5 = 15

        resp = client.get("/api/v1/assets/", params={"sort": "risk_desc"}, headers=headers)
        assert resp.status_code == 200, resp.text
        names = [a["name"] for a in resp.json()["assets"]]
        assert names == ["charlie", "bravo", "alpha"]  # ties broken by name

    def test_single_asset_includes_risk(self, client):
        headers = _register_and_login(client, "risk-single@example.com")
        uid = _user_id(client, headers)
        asset_id = _make_asset(uid, "solo", "medium")
        _make_alert(uid, asset_id, "s1", "critical")

        resp = client.get(f"/api/v1/assets/{asset_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["risk_score"] == 10
        assert resp.json()["risk_level"] == "medium"
