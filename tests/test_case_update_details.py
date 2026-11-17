"""Tests for editing case title and summary via PATCH /api/v1/cases/{id}."""

from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_update_details.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_update_details.db"
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


def _make_case(client: TestClient, headers, title: str = "Original title") -> int:
    res = client.post("/api/v1/cases/", json={"title": title, "severity": "high"}, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


class TestCaseDetailEditing:
    def test_update_title_and_summary(self, client):
        headers = _register_and_login(client, "edit@example.com")
        case_id = _make_case(client, headers)
        res = client.patch(
            f"/api/v1/cases/{case_id}",
            params={"title": "  Renamed case  ", "summary": "New context"},
            headers=headers,
        )
        assert res.status_code == 200
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["title"] == "Renamed case"
        assert got.json()["summary"] == "New context"

    def test_blank_title_rejected(self, client):
        headers = _register_and_login(client, "blank@example.com")
        case_id = _make_case(client, headers)
        res = client.patch(f"/api/v1/cases/{case_id}", params={"title": "   "}, headers=headers)
        assert res.status_code == 400
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["title"] == "Original title"

    def test_empty_summary_clears_it(self, client):
        headers = _register_and_login(client, "clear@example.com")
        case_id = _make_case(client, headers)
        client.patch(f"/api/v1/cases/{case_id}", params={"summary": "Something"}, headers=headers)
        res = client.patch(f"/api/v1/cases/{case_id}", params={"summary": "  "}, headers=headers)
        assert res.status_code == 200
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["summary"] is None

    def test_other_users_case_untouched(self, client):
        headers_a = _register_and_login(client, "owner@example.com")
        headers_b = _register_and_login(client, "other@example.com")
        case_id = _make_case(client, headers_a)
        res = client.patch(f"/api/v1/cases/{case_id}", params={"title": "Hijack"}, headers=headers_b)
        assert res.status_code == 404
