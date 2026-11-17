"""Tests for alert notes."""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_notes.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_notes.db"
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
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0010",
            title="PLC weak authentication", severity="high", status="pending",
            created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


class TestAlertNotes:
    def test_create_and_list(self, client):
        headers = _register_and_login(client, "notes@example.com")
        alert_id = _seed_alert(client, headers)

        resp = client.post(
            f"/api/v1/alerts/{alert_id}/notes", json={"body": "Vendor confirms patch due Friday"}, headers=headers,
        )
        assert resp.status_code == 201, resp.text
        note = resp.json()
        assert note["body"] == "Vendor confirms patch due Friday"
        assert note["alert_id"] == alert_id

        client.post(f"/api/v1/alerts/{alert_id}/notes", json={"body": "Second note"}, headers=headers)
        listing = client.get(f"/api/v1/alerts/{alert_id}/notes", headers=headers)
        assert listing.status_code == 200
        bodies = [n["body"] for n in listing.json()]
        assert bodies == ["Vendor confirms patch due Friday", "Second note"]

    def test_blank_note_rejected(self, client):
        headers = _register_and_login(client, "blanknote@example.com")
        alert_id = _seed_alert(client, headers)
        assert client.post(
            f"/api/v1/alerts/{alert_id}/notes", json={"body": "   "}, headers=headers,
        ).status_code == 400

    def test_delete_note(self, client):
        headers = _register_and_login(client, "delnote@example.com")
        alert_id = _seed_alert(client, headers)
        note_id = client.post(
            f"/api/v1/alerts/{alert_id}/notes", json={"body": "obsolete"}, headers=headers,
        ).json()["id"]
        resp = client.delete(f"/api/v1/alerts/{alert_id}/notes/{note_id}", headers=headers)
        assert resp.status_code == 204
        assert client.get(f"/api/v1/alerts/{alert_id}/notes", headers=headers).json() == []
        assert client.delete(f"/api/v1/alerts/{alert_id}/notes/{note_id}", headers=headers).status_code == 404

    def test_notes_on_other_users_alert_404(self, client):
        owner = _register_and_login(client, "owner4@example.com")
        other = _register_and_login(client, "other4@example.com")
        alert_id = _seed_alert(client, owner)
        assert client.get(f"/api/v1/alerts/{alert_id}/notes", headers=other).status_code == 404
        assert client.post(
            f"/api/v1/alerts/{alert_id}/notes", json={"body": "intrusion"}, headers=other,
        ).status_code == 404
        assert client.delete(f"/api/v1/alerts/{alert_id}/notes/1", headers=other).status_code == 404

    def test_notes_on_missing_alert_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        assert client.get("/api/v1/alerts/9999/notes", headers=headers).status_code == 404
