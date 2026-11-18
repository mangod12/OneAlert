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
            "muted_kinds": [],
            "quiet_hours_start": None,
            "quiet_hours_end": None,
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
            "muted_kinds": [],
            "quiet_hours_start": None,
            "quiet_hours_end": None,
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
            "muted_kinds": [],
            "quiet_hours_start": None,
            "quiet_hours_end": None,
        }

    def test_invalid_severity_rejected(self, client):
        headers = _register_and_login(client, "invalid@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"notify_min_severity": "urgent"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_muted_kinds_update(self, client):
        headers = _register_and_login(client, "muted@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": ["case_assigned"]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["muted_kinds"] == ["case_assigned"]
        confirm = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert confirm.json()["muted_kinds"] == ["case_assigned"]

    def test_partial_patch_keeps_muted_kinds(self, client):
        headers = _register_and_login(client, "keepmuted@example.com")
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": ["alert_created"]},
            headers=headers,
        )
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"notify_min_severity": "high"},
            headers=headers,
        )
        confirm = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert confirm.json()["muted_kinds"] == ["alert_created"]

    def test_unknown_muted_kind_rejected(self, client):
        headers = _register_and_login(client, "unknownkind@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": ["not_a_kind"]},
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


class TestQuietHoursGating:
    def _user(self, start="22:00", end="06:00"):
        return SimpleNamespace(
            email_notifications_enabled=True,
            notify_min_severity="low",
            quiet_hours_start=start,
            quiet_hours_end=end,
        )

    def test_overnight_window_suppresses_non_critical(self):
        from datetime import time
        user = self._user()
        assert not _should_email_user(user, "high", now=time(23, 30))
        assert not _should_email_user(user, "medium", now=time(3, 0))

    def test_overnight_window_still_sends_critical(self):
        from datetime import time
        assert _should_email_user(self._user(), "critical", now=time(2, 0))

    def test_outside_window_sends(self):
        from datetime import time
        assert _should_email_user(self._user(), "high", now=time(12, 0))

    def test_same_day_window(self):
        from datetime import time
        user = self._user("12:00", "14:00")
        assert not _should_email_user(user, "low", now=time(13, 0))
        assert _should_email_user(user, "low", now=time(14, 0))
        assert _should_email_user(user, "low", now=time(11, 59))

    def test_unset_or_zero_length_window_mutes_nothing(self):
        from datetime import time
        no_hours = SimpleNamespace(
            email_notifications_enabled=True, notify_min_severity="low",
            quiet_hours_start=None, quiet_hours_end=None,
        )
        assert _should_email_user(no_hours, "low", now=time(2, 0))
        zero = self._user("08:00", "08:00")
        assert _should_email_user(zero, "low", now=time(8, 0))


class TestQuietHours:
    def test_roundtrip_quiet_hours(self, client):
        headers = _register_and_login(client, "quiet@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"quiet_hours_start": "22:00", "quiet_hours_end": "06:00"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["quiet_hours_start"] == "22:00"
        assert resp.json()["quiet_hours_end"] == "06:00"
        confirm = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert confirm.json()["quiet_hours_start"] == "22:00"

    def test_unpaired_quiet_hours_rejected(self, client):
        headers = _register_and_login(client, "unpaired@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"quiet_hours_start": "22:00"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_clear_quiet_hours_with_null_pair(self, client):
        headers = _register_and_login(client, "clearquiet@example.com")
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"quiet_hours_start": "22:00", "quiet_hours_end": "06:00"},
            headers=headers,
        )
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"quiet_hours_start": None, "quiet_hours_end": None},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["quiet_hours_start"] is None
        assert resp.json()["quiet_hours_end"] is None

    def test_invalid_quiet_hours_format_rejected(self, client):
        headers = _register_and_login(client, "badformat@example.com")
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"quiet_hours_start": "10pm", "quiet_hours_end": "25:00"},
            headers=headers,
        )
        assert resp.status_code == 422
