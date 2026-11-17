"""Tests for the `search` substring filter on GET /api/v1/alerts/."""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alerts_search.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alerts_search.db"
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


def _seed_alerts(client: TestClient, headers):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="edge-router-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        db.add(Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0001",
            title="RouterOS remote code execution", severity="critical",
            status="pending", created_at=datetime(2026, 11, 1, tzinfo=UTC),
        ))
        db.add(Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0002",
            title="PLC weak authentication", severity="high",
            status="pending", created_at=datetime(2026, 11, 2, tzinfo=UTC),
        ))
        db.commit()


class TestAlertsSearch:
    def test_search_matches_cve_substring(self, client):
        headers = _register_and_login(client, "asearch-cve@example.com")
        _seed_alerts(client, headers)
        res = client.get("/api/v1/alerts/", params={"search": "2026-0001"}, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["total"] == 1
        assert body["alerts"][0]["cve_id"] == "CVE-2026-0001"

    def test_search_matches_title_case_insensitive(self, client):
        headers = _register_and_login(client, "asearch-title@example.com")
        _seed_alerts(client, headers)
        res = client.get("/api/v1/alerts/", params={"search": "weak AUTH"}, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["total"] == 1
        assert body["alerts"][0]["title"] == "PLC weak authentication"

    def test_search_no_match_returns_empty(self, client):
        headers = _register_and_login(client, "asearch-none@example.com")
        _seed_alerts(client, headers)
        res = client.get("/api/v1/alerts/", params={"search": "log4shell"}, headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 0
