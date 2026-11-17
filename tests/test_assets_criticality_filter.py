"""Tests for the `criticality` filter on GET /api/v1/assets/."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_criticality_filter.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_criticality_filter.db"
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


def _make_asset(client: TestClient, headers, name: str, criticality: str):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    with _TestingSessionLocal() as db:
        db.add(Asset(
            user_id=me.json()["id"],
            name=name,
            asset_type="hardware",
            criticality=criticality,
        ))
        db.commit()


class TestAssetCriticalityFilter:
    def test_filters_by_criticality(self, client):
        headers = _register_and_login(client, "crit@example.com")
        _make_asset(client, headers, "gw-1", "high")
        _make_asset(client, headers, "gw-2", "low")
        _make_asset(client, headers, "gw-3", "high")
        res = client.get("/api/v1/assets/", params={"criticality": "high"}, headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["total"] == 2
        assert {a["name"] for a in body["assets"]} == {"gw-1", "gw-3"}

    def test_no_filter_returns_all(self, client):
        headers = _register_and_login(client, "crit-all@example.com")
        _make_asset(client, headers, "gw-1", "high")
        _make_asset(client, headers, "gw-2", "low")
        res = client.get("/api/v1/assets/", headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 2

    def test_unknown_criticality_matches_nothing(self, client):
        headers = _register_and_login(client, "crit-none@example.com")
        _make_asset(client, headers, "gw-1", "high")
        res = client.get("/api/v1/assets/", params={"criticality": "bogus"}, headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == 0
