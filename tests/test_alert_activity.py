"""Tests for the per-alert audit-trail activity feed."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_activity.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_activity.db"
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


def _seed_alert(client: TestClient, headers) -> int:
    user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0011",
            title="PLC weak authentication", severity="high", status="pending",
            created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


class TestAlertActivity:
    def test_status_change_appears_in_activity(self, client):
        headers = _register_and_login(client, "activity@example.com")
        alert_id = _seed_alert(client, headers)

        resp = client.patch(
            f"/api/v1/alerts/{alert_id}", json={"status": "acknowledged"}, headers=headers,
        )
        assert resp.status_code == 200, resp.text

        listing = client.get(f"/api/v1/alerts/{alert_id}/activity", headers=headers)
        assert listing.status_code == 200, listing.text
        rows = listing.json()
        assert any(
            r["action"] == "alert_updated" and "status" in (r["detail"] or "")
            for r in rows
        )
        assert all("timestamp" in r and "id" in r for r in rows)

    def test_empty_when_no_changes(self, client):
        headers = _register_and_login(client, "emptyactivity@example.com")
        alert_id = _seed_alert(client, headers)
        listing = client.get(f"/api/v1/alerts/{alert_id}/activity", headers=headers)
        assert listing.status_code == 200
        assert listing.json() == []

    def test_not_visible_to_other_users(self, client):
        headers = _register_and_login(client, "owner@example.com")
        alert_id = _seed_alert(client, headers)
        client.patch(f"/api/v1/alerts/{alert_id}", json={"status": "acknowledged"}, headers=headers)

        other = _register_and_login(client, "intruder@example.com")
        resp = client.get(f"/api/v1/alerts/{alert_id}/activity", headers=other)
        assert resp.status_code == 404
