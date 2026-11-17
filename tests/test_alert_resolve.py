"""Tests for resolving alerts via POST /api/v1/alerts/{id}/resolve."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_resolve.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_resolve.db"
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


def _make_alert(client: TestClient, headers, title: str = "OpenSSL CVE") -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        alert = Alert(
            user_id=uid, asset_id=asset.id, title=title,
            severity="high", status="pending",
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


class TestResolveAlert:
    def test_resolve_sets_status(self, client):
        headers = _register_and_login(client, "resolver@example.com")
        alert_id = _make_alert(client, headers)

        resp = client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["message"] == "Alert resolved successfully"

        detail = client.get(f"/api/v1/alerts/{alert_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["status"] == "resolved"

    def test_resolved_alert_matches_status_filter(self, client):
        headers = _register_and_login(client, "filter@example.com")
        alert_id = _make_alert(client, headers)
        client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=headers)

        resp = client.get("/api/v1/alerts/?status=resolved", headers=headers)
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["alerts"]]
        assert ids == [alert_id]

        pending = client.get("/api/v1/alerts/?status=pending", headers=headers)
        assert pending.json()["alerts"] == []

    def test_resolve_other_users_alert_404(self, client):
        owner = _register_and_login(client, "owner@example.com")
        intruder = _register_and_login(client, "intruder@example.com")
        alert_id = _make_alert(client, owner)

        resp = client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=intruder)
        assert resp.status_code == 404

    def test_resolve_missing_alert_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        resp = client.post("/api/v1/alerts/99999/resolve", headers=headers)
        assert resp.status_code == 404
