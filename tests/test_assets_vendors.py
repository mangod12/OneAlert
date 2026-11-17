"""Tests for GET /api/v1/assets/vendors/ (distinct vendor list)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_vendors.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_vendors.db"
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


def _make_asset(client: TestClient, headers, name: str, vendor: str | None):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    with _TestingSessionLocal() as db:
        db.add(Asset(
            user_id=me.json()["id"],
            name=name,
            asset_type="hardware",
            vendor=vendor,
        ))
        db.commit()


class TestAssetVendors:
    def test_returns_distinct_sorted_vendors(self, client):
        headers = _register_and_login(client, "vendors@example.com")
        _make_asset(client, headers, "gw-1", "Cisco")
        _make_asset(client, headers, "gw-2", "Acme")
        _make_asset(client, headers, "gw-3", "Cisco")
        _make_asset(client, headers, "gw-4", None)
        _make_asset(client, headers, "gw-5", "")
        res = client.get("/api/v1/assets/vendors/", headers=headers)
        assert res.status_code == 200, res.text
        assert res.json() == ["Acme", "Cisco"]

    def test_excludes_other_users_vendors(self, client):
        headers_one = _register_and_login(client, "vendors-one@example.com")
        headers_two = _register_and_login(client, "vendors-two@example.com")
        _make_asset(client, headers_one, "gw-a", "Acme")
        _make_asset(client, headers_two, "gw-b", "OtherCo")
        res = client.get("/api/v1/assets/vendors/", headers=headers_one)
        assert res.status_code == 200, res.text
        assert res.json() == ["Acme"]

    def test_empty_inventory_returns_empty_list(self, client):
        headers = _register_and_login(client, "vendors-empty@example.com")
        res = client.get("/api/v1/assets/vendors/", headers=headers)
        assert res.status_code == 200, res.text
        assert res.json() == []
