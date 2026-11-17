"""Tests for per-user email notification preferences."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.services.alert_checker import _should_email_user

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_notif_prefs.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_notif_prefs.db"
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


class TestNotificationPreferenceEndpoints:
    def test_defaults_are_enabled_at_low(self, client):
        headers = _register_and_login(client, "prefs@example.com")
        resp = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "email_notifications_enabled": True,
            "notify_min_severity": "low",
        }

    def test_patch_updates_both_fields(self, client):
        headers = _register_and_login(client, "patch@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"email_notifications_enabled": False, "notify_min_severity": "high"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "email_notifications_enabled": False,
            "notify_min_severity": "high",
        }
        confirm = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert confirm.json()["notify_min_severity"] == "high"

    def test_partial_patch_keeps_other_field(self, client):
        headers = _register_and_login(client, "partial@example.com")
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"notify_min_severity": "critical"},
            headers=headers,
        )
        confirm = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert confirm.json() == {
            "email_notifications_enabled": True,
            "notify_min_severity": "critical",
        }

    def test_invalid_severity_rejected(self, client):
        headers = _register_and_login(client, "invalid@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"notify_min_severity": "urgent"},
            headers=headers,
        )
        assert resp.status_code == 422


class TestShouldEmailUser:
    def _user(self, enabled=True, minimum="low"):
        return SimpleNamespace(
            email_notifications_enabled=enabled,
            notify_min_severity=minimum,
        )

    def test_disabled_user_gets_nothing(self):
        assert not _should_email_user(self._user(enabled=False), "critical")

    def test_severity_below_minimum_suppressed(self):
        assert not _should_email_user(self._user(minimum="high"), "medium")
        assert not _should_email_user(self._user(minimum="critical"), "high")

    def test_severity_at_or_above_minimum_sent(self):
        assert _should_email_user(self._user(minimum="high"), "high")
        assert _should_email_user(self._user(minimum="high"), "critical")
        assert _should_email_user(self._user(minimum="low"), "low")

    def test_case_insensitive_and_unknown_severity_sent(self):
        assert _should_email_user(self._user(minimum="critical"), "HIGH") is False
        assert _should_email_user(self._user(minimum="critical"), "unknown")
        assert _should_email_user(self._user(minimum="critical"), None)
