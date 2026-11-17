"""Tests for the `ip` substring filter on GET /api/v1/events/."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.security_event import SecurityEvent
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_events_ip_filter.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_events_ip_filter.db"
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


def _make_event(client: TestClient, headers, source_ip: str, dest_ip: str, signature: str):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    with _TestingSessionLocal() as db:
        db.add(SecurityEvent(
            user_id=me.json()["id"],
            timestamp=datetime.now(UTC),
            event_type="alert",
            severity="high",
            signature=signature,
            source_ip=source_ip,
            dest_ip=dest_ip,
            source_type="suricata",
        ))
        db.commit()


class TestEventIpFilter:
    def _seed(self, client, headers):
        _make_event(client, headers, "10.0.0.8", "10.0.1.10", "src-match")
        _make_event(client, headers, "192.168.1.5", "10.0.0.8", "dest-match")
        _make_event(client, headers, "192.168.1.6", "192.168.1.7", "no-match")

    def test_matches_source_ip(self, client):
        headers = _register_and_login(client, "src@example.com")
        self._seed(client, headers)
        res = client.get("/api/v1/events/?ip=10.0.0.8", headers=headers)
        assert res.status_code == 200
        sigs = {e["signature"] for e in res.json()["events"]}
        assert sigs == {"src-match", "dest-match"}
        assert res.json()["total"] == 2

    def test_substring_matches_prefix(self, client):
        headers = _register_and_login(client, "prefix@example.com")
        self._seed(client, headers)
        res = client.get("/api/v1/events/?ip=192.168", headers=headers)
        assert res.status_code == 200
        assert res.json()["total"] == 2

    def test_combines_with_severity(self, client):
        headers = _register_and_login(client, "combo@example.com")
        self._seed(client, headers)
        res = client.get("/api/v1/events/?ip=10.0.0.8&severity=low", headers=headers)
        assert res.status_code == 200
        assert res.json()["total"] == 0

    def test_no_param_returns_all(self, client):
        headers = _register_and_login(client, "all@example.com")
        self._seed(client, headers)
        res = client.get("/api/v1/events/", headers=headers)
        assert res.status_code == 200
        assert res.json()["total"] == 3
