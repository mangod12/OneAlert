"""Tests for the `signature` substring filter on GET /api/v1/events/."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.security_event import SecurityEvent

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_events_signature_search.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_events_signature_search.db"
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


def _make_event(client: TestClient, headers, signature: str):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    with _TestingSessionLocal() as db:
        db.add(SecurityEvent(
            user_id=me.json()["id"],
            timestamp=datetime.now(UTC),
            event_type="alert",
            severity="high",
            signature=signature,
            source_ip="10.0.0.1",
            dest_ip="10.0.0.2",
            source_type="suricata",
        ))
        db.commit()


class TestEventSignatureSearch:
    def test_signature_substring_match(self, client):
        headers = _register_and_login(client, "sig@example.com")
        _make_event(client, headers, "ET SCAN SSH brute force")
        _make_event(client, headers, "ET EXPLOIT RouterOS RCE attempt")
        res = client.get("/api/v1/events/", params={"signature": "brute force"}, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["total"] == 1
        assert body["events"][0]["signature"] == "ET SCAN SSH brute force"

    def test_signature_match_is_case_insensitive(self, client):
        headers = _register_and_login(client, "sig-case@example.com")
        _make_event(client, headers, "ET SCAN SSH brute force")
        res = client.get("/api/v1/events/", params={"signature": "ssh Brute"}, headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 1

    def test_signature_no_match_returns_empty(self, client):
        headers = _register_and_login(client, "sig-none@example.com")
        _make_event(client, headers, "ET SCAN SSH brute force")
        res = client.get("/api/v1/events/", params={"signature": "dns tunnel"}, headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 0
