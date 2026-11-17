"""Tests for the `sort` parameter on GET /api/v1/cases/."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_cases_sort.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_cases_sort.db"
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


def _seed_cases(client: TestClient, headers):
    """Create three cases with distinct severities and creation dates."""
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]
    base = datetime(2026, 11, 1, 12, 0, 0, tzinfo=UTC)
    with _TestingSessionLocal() as db:
        for title, severity, days in [
            ("Old low", "low", 0),
            ("Mid critical", "critical", 1),
            ("New medium", "medium", 2),
        ]:
            db.add(Case(
                user_id=user_id,
                title=title,
                severity=severity,
                status="open",
                created_at=base + timedelta(days=days),
            ))
        db.commit()


class TestCasesSort:
    def test_default_sort_newest_first(self, client):
        headers = _register_and_login(client, "csort-default@example.com")
        _seed_cases(client, headers)
        res = client.get("/api/v1/cases/", headers=headers)
        assert res.status_code == 200, res.text
        titles = [c["title"] for c in res.json()["cases"]]
        assert titles == ["New medium", "Mid critical", "Old low"]

    def test_sort_created_at_asc(self, client):
        headers = _register_and_login(client, "csort-asc@example.com")
        _seed_cases(client, headers)
        res = client.get("/api/v1/cases/", params={"sort": "created_at_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        titles = [c["title"] for c in res.json()["cases"]]
        assert titles == ["Old low", "Mid critical", "New medium"]

    def test_sort_severity_desc(self, client):
        headers = _register_and_login(client, "csort-sev-desc@example.com")
        _seed_cases(client, headers)
        res = client.get("/api/v1/cases/", params={"sort": "severity_desc"}, headers=headers)
        assert res.status_code == 200, res.text
        titles = [c["title"] for c in res.json()["cases"]]
        assert titles == ["Mid critical", "New medium", "Old low"]

    def test_sort_severity_asc(self, client):
        headers = _register_and_login(client, "csort-sev-asc@example.com")
        _seed_cases(client, headers)
        res = client.get("/api/v1/cases/", params={"sort": "severity_asc"}, headers=headers)
        assert res.status_code == 200, res.text
        titles = [c["title"] for c in res.json()["cases"]]
        assert titles == ["Old low", "New medium", "Mid critical"]

    def test_invalid_sort_rejected(self, client):
        headers = _register_and_login(client, "csort-invalid@example.com")
        _seed_cases(client, headers)
        res = client.get("/api/v1/cases/", params={"sort": "bogus"}, headers=headers)
        assert res.status_code == 422
