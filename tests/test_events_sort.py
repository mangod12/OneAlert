"""Tests for the `sort` parameter on GET /api/v1/events/."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.security_event import SecurityEvent

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_events_sort.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_events_sort.db"
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


def _seed_events(client: TestClient, headers):
    """Create three events with distinct severities and timestamps."""
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    base = datetime(2026, 11, 1, 12, 0, 0, tzinfo=UTC)
    with _TestingSessionLocal() as db:
        for sig, severity, days in [
            ("old-low", "low", 0),
            ("mid-critical", "critical", 1),
            ("new-medium", "medium", 2),
        ]:
            db.add(SecurityEvent(
                user_id=user_id,
                timestamp=base + timedelta(days=days),
                event_type="alert",
                severity=severity,
                signature=sig,
                source_ip="10.0.0.1",
                dest_ip="10.0.0.2",
                source_type="suricata",
            ))
        db.commit()


class TestEventsSort:
    def test_default_sort_newest_first(self, client):
        headers = _register_and_login(client, "esort-default@example.com")
        _seed_events(client, headers)
        res = client.get("/api/v1/events/", headers=headers)
        assert res.status_code == 200, res.text
        sigs = [e["signature"] for e in res.json()["events"]]
        assert sigs == ["new-medium", "mid-critical", "old-low"]

    def test_sort_timestamp_asc(self, client):
        headers = _register_and_login(client, "esort-asc@example.com")
        _seed_events(client, headers)
        res = client.get("/api/v1/events/", params={"sort": "timestamp_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        sigs = [e["signature"] for e in res.json()["events"]]
        assert sigs == ["old-low", "mid-critical", "new-medium"]

    def test_sort_severity_desc(self, client):
        headers = _register_and_login(client, "esort-sev-desc@example.com")
        _seed_events(client, headers)
        res = client.get("/api/v1/events/", params={"sort": "severity_desc"}, headers=headers)
        assert res.status_code == 200, res.text
        sigs = [e["signature"] for e in res.json()["events"]]
        assert sigs == ["mid-critical", "new-medium", "old-low"]

    def test_sort_severity_asc(self, client):
        headers = _register_and_login(client, "esort-sev-asc@example.com")
        _seed_events(client, headers)
        res = client.get("/api/v1/events/", params={"sort": "severity_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        sigs = [e["signature"] for e in res.json()["events"]]
        assert sigs == ["old-low", "new-medium", "mid-critical"]

    def test_invalid_sort_rejected(self, client):
        headers = _register_and_login(client, "esort-invalid@example.com")
        _seed_events(client, headers)
        res = client.get("/api/v1/events/", params={"sort": "bogus"}, headers=headers)
        assert res.status_code == 422
