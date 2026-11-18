"""Tests for updating the current user's profile via PATCH /api/v1/auth/me."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_profile_update.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_profile_update.db"
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
        "email": email, "password": password, "full_name": "Analyst", "company": "TestCorp",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


class TestProfileUpdate:
    def test_updates_name_and_company(self, client):
        headers = _register_and_login(client, "profile@example.com")
        resp = client.patch(
            "/api/v1/auth/me",
            json={"full_name": "New Name", "company": "New Corp"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["full_name"] == "New Name"
        assert resp.json()["company"] == "New Corp"

        confirm = client.get("/api/v1/auth/me", headers=headers)
        assert confirm.json()["full_name"] == "New Name"
        assert confirm.json()["company"] == "New Corp"

    def test_partial_update_keeps_other_field(self, client):
        headers = _register_and_login(client, "partial@example.com")
        resp = client.patch(
            "/api/v1/auth/me",
            json={"full_name": "Renamed"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["full_name"] == "Renamed"
        assert resp.json()["company"] == "TestCorp"

    def test_blank_values_clear_to_null(self, client):
        headers = _register_and_login(client, "blank@example.com")
        resp = client.patch(
            "/api/v1/auth/me",
            json={"full_name": "   ", "company": ""},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["full_name"] is None
        assert resp.json()["company"] is None

    def test_requires_authentication(self, client):
        resp = client.patch("/api/v1/auth/me", json={"full_name": "Nope"})
        assert resp.status_code == 401, resp.text
