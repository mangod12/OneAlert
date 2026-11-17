"""Tests for alert snoozing."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_snooze.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_snooze.db"
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


def _seed_alert(client: TestClient, headers, title="PLC weak authentication") -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0009",
            title=title, severity="high", status="pending",
            created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


def _list_titles(client, headers, **params):
    res = client.get("/api/v1/alerts/", params=params, headers=headers)
    assert res.status_code == 200, res.text
    return [a["title"] for a in res.json()["alerts"]]


class TestAlertSnooze:
    def test_snooze_hides_from_default_list(self, client):
        headers = _register_and_login(client, "snooze@example.com")
        alert_id = _seed_alert(client, headers)

        resp = client.post(f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["snoozed_until"] is not None

        assert _list_titles(client, headers) == []
        assert _list_titles(client, headers, snoozed="all") == ["PLC weak authentication"]
        assert _list_titles(client, headers, snoozed="only") == ["PLC weak authentication"]
        listed = client.get(
            "/api/v1/alerts/", params={"snoozed": "all"}, headers=headers,
        ).json()["alerts"][0]
        assert listed["snoozed_until"] is not None

    def test_expired_snooze_returns_to_default_list(self, client):
        headers = _register_and_login(client, "expired@example.com")
        alert_id = _seed_alert(client, headers)
        with _TestingSessionLocal() as db:
            alert = db.get(Alert, alert_id)
            alert.snoozed_until = datetime.now(UTC) - timedelta(hours=1)
            db.commit()

        assert _list_titles(client, headers) == ["PLC weak authentication"]
        assert _list_titles(client, headers, snoozed="only") == []

    def test_unsnooze(self, client):
        headers = _register_and_login(client, "unsnooze@example.com")
        alert_id = _seed_alert(client, headers)
        client.post(f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=headers)
        assert _list_titles(client, headers) == []

        resp = client.delete(f"/api/v1/alerts/{alert_id}/snooze", headers=headers)
        assert resp.status_code == 200, resp.text
        assert _list_titles(client, headers) == ["PLC weak authentication"]

    def test_acknowledge_and_resolve_clear_snooze(self, client):
        headers = _register_and_login(client, "clear@example.com")
        alert_id = _seed_alert(client, headers)
        client.post(f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=headers)

        resp = client.post(f"/api/v1/alerts/{alert_id}/acknowledge", headers=headers)
        assert resp.status_code == 200
        with _TestingSessionLocal() as db:
            assert db.get(Alert, alert_id).snoozed_until is None

        client.post(f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=headers)
        resp = client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=headers)
        assert resp.status_code == 200
        with _TestingSessionLocal() as db:
            assert db.get(Alert, alert_id).snoozed_until is None

    def test_hours_bounds_validated(self, client):
        headers = _register_and_login(client, "bounds@example.com")
        alert_id = _seed_alert(client, headers)
        assert client.post(
            f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 0}, headers=headers,
        ).status_code == 422
        assert client.post(
            f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 721}, headers=headers,
        ).status_code == 422

    def test_snooze_other_users_alert_404(self, client):
        owner = _register_and_login(client, "owner3@example.com")
        other = _register_and_login(client, "other3@example.com")
        alert_id = _seed_alert(client, owner)
        assert client.post(
            f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=other,
        ).status_code == 404
        assert client.delete(f"/api/v1/alerts/{alert_id}/snooze", headers=other).status_code == 404

    def test_invalid_snoozed_filter_rejected(self, client):
        headers = _register_and_login(client, "badfilter@example.com")
        _seed_alert(client, headers)
        res = client.get("/api/v1/alerts/", params={"snoozed": "bogus"}, headers=headers)
        assert res.status_code == 422


class TestExportSnoozeFilter:
    def test_export_respects_snooze_filter(self, client):
        headers = _register_and_login(client, "export@example.com")
        alert_id = _seed_alert(client, headers)
        client.post(f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=headers)

        res = client.get("/api/v1/alerts/export", headers=headers)
        assert res.status_code == 200
        assert "PLC weak authentication" not in res.text
        assert "snoozed_until" in res.text.splitlines()[0]

        res = client.get("/api/v1/alerts/export", params={"snoozed": "all"}, headers=headers)
        assert "PLC weak authentication" in res.text
