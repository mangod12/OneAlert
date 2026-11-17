"""Tests for the `sort` parameter on GET /api/v1/assets/."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_sort.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_sort.db"
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


def _seed_assets(client: TestClient, headers):
    """Create three assets with distinct names, criticalities, and dates."""
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    base = datetime(2026, 11, 1, 12, 0, 0, tzinfo=UTC)
    with _TestingSessionLocal() as db:
        for name, criticality, days in [
            ("zebra-plc", "low", 0),
            ("alpha-gateway", "critical", 1),
            ("mike-historian", "medium", 2),
        ]:
            db.add(Asset(
                user_id=user_id,
                name=name,
                asset_type="hardware",
                criticality=criticality,
                created_at=base + timedelta(days=days),
            ))
        db.commit()


class TestAssetsSort:
    def test_default_sort_newest_first(self, client):
        headers = _register_and_login(client, "asort-default@example.com")
        _seed_assets(client, headers)
        res = client.get("/api/v1/assets/", headers=headers)
        assert res.status_code == 200, res.text
        names = [a["name"] for a in res.json()["assets"]]
        assert names == ["mike-historian", "alpha-gateway", "zebra-plc"]

    def test_sort_name_asc(self, client):
        headers = _register_and_login(client, "asort-name@example.com")
        _seed_assets(client, headers)
        res = client.get("/api/v1/assets/", params={"sort": "name_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        names = [a["name"] for a in res.json()["assets"]]
        assert names == ["alpha-gateway", "mike-historian", "zebra-plc"]

    def test_sort_created_at_asc(self, client):
        headers = _register_and_login(client, "asort-asc@example.com")
        _seed_assets(client, headers)
        res = client.get("/api/v1/assets/", params={"sort": "created_at_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        names = [a["name"] for a in res.json()["assets"]]
        assert names == ["zebra-plc", "alpha-gateway", "mike-historian"]

    def test_sort_criticality_desc(self, client):
        headers = _register_and_login(client, "asort-crit@example.com")
        _seed_assets(client, headers)
        res = client.get("/api/v1/assets/", params={"sort": "criticality_desc"}, headers=headers)
        assert res.status_code == 200, res.text
        names = [a["name"] for a in res.json()["assets"]]
        assert names == ["alpha-gateway", "mike-historian", "zebra-plc"]

    def test_invalid_sort_rejected(self, client):
        headers = _register_and_login(client, "asort-invalid@example.com")
        _seed_assets(client, headers)
        res = client.get("/api/v1/assets/", params={"sort": "bogus"}, headers=headers)
        assert res.status_code == 422
