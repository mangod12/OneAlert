"""
Tests for severity-based SLA due dates on investigations.

Covers: SLA fields on the automation-preferences endpoint, validation,
and automatic due dates on manually created cases when enabled.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_sla_due_dates.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_sla_due_dates.db"
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


def register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    """Register a user and return auth headers."""
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
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestSlaPreferences:
    def test_update_roundtrip(self, client):
        headers = register_and_login(client, "sla_prefs@example.com")
        resp = client.patch("/api/v1/auth/me/automation-preferences", headers=headers, json={
            "sla_due_dates_enabled": True,
            "sla_days_critical": 1,
            "sla_days_high": 5,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["sla_due_dates_enabled"] is True
        assert resp.json()["sla_days_critical"] == 1
        assert resp.json()["sla_days_high"] == 5
        # Untouched severities keep their defaults.
        assert resp.json()["sla_days_medium"] == 7

        again = client.get("/api/v1/auth/me/automation-preferences", headers=headers)
        assert again.json()["sla_days_high"] == 5

    def test_auto_assign_roundtrip(self, client):
        headers = register_and_login(client, "auto_assign@example.com")
        before = client.get("/api/v1/auth/me/automation-preferences", headers=headers)
        assert before.json()["auto_assign_new_alerts"] is False
        resp = client.patch("/api/v1/auth/me/automation-preferences", headers=headers, json={
            "auto_assign_new_alerts": True,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["auto_assign_new_alerts"] is True
        again = client.get("/api/v1/auth/me/automation-preferences", headers=headers)
        assert again.json()["auto_assign_new_alerts"] is True

    def test_validation(self, client):
        headers = register_and_login(client, "sla_valid@example.com")
        assert client.patch(
            "/api/v1/auth/me/automation-preferences", headers=headers,
            json={"sla_days_high": 0},
        ).status_code == 422
        assert client.patch(
            "/api/v1/auth/me/automation-preferences", headers=headers,
            json={"sla_days_low": 91},
        ).status_code == 422


class TestSlaDueDates:
    def test_new_case_gets_due_date_by_severity(self, client):
        headers = register_and_login(client, "sla_case@example.com")
        client.patch("/api/v1/auth/me/automation-preferences", headers=headers, json={
            "sla_due_dates_enabled": True,
            "sla_days_critical": 2,
            "sla_days_low": 10,
        })
        today = datetime.now(UTC).date()

        critical = client.post("/api/v1/cases/", json={
            "title": "Ransomware on historian", "severity": "critical",
        }, headers=headers)
        assert critical.status_code == 201, critical.text
        assert critical.json()["due_date"] == (today + timedelta(days=2)).isoformat()

        low = client.post("/api/v1/cases/", json={
            "title": "Stale certificate", "severity": "low",
        }, headers=headers)
        assert low.status_code == 201, low.text
        assert low.json()["due_date"] == (today + timedelta(days=10)).isoformat()

    def test_new_case_has_no_due_date_when_disabled(self, client):
        headers = register_and_login(client, "sla_off@example.com")
        resp = client.post("/api/v1/cases/", json={
            "title": "No SLA here", "severity": "critical",
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        assert resp.json()["due_date"] is None
