"""Tests for severity sort orders on GET /api/v1/alerts/."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_severity_sort.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_severity_sort.db"
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


def _register_and_login(client: TestClient, email: str = "sort@example.com"):
    password = "securepass123"
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed_alerts(client: TestClient, headers):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        for i, sev in enumerate(["medium", "critical", "low", "high"]):
            db.add(Alert(
                user_id=uid, asset_id=asset.id, title=f"alert-{sev}-{i}",
                severity=sev, status="pending",
            ))
        db.commit()


def _titles(resp) -> list[str]:
    assert resp.status_code == 200, resp.text
    return [a["title"] for a in resp.json()["alerts"]]


class TestSeveritySort:
    def test_severity_desc_ranks_known_first_unknown_last(self, client):
        headers = _register_and_login(client)
        _seed_alerts(client, headers)
        titles = _titles(client.get("/api/v1/alerts/?sort=severity_desc&size=50", headers=headers))
        severities = [t.split("-")[1] for t in titles]
        assert severities == ["critical", "high", "medium", "low"]

    def test_severity_asc_reverses(self, client):
        headers = _register_and_login(client)
        _seed_alerts(client, headers)
        titles = _titles(client.get("/api/v1/alerts/?sort=severity_asc&size=50", headers=headers))
        severities = [t.split("-")[1] for t in titles]
        assert severities == ["low", "medium", "high", "critical"]

    def test_invalid_sort_rejected(self, client):
        headers = _register_and_login(client)
        resp = client.get("/api/v1/alerts/?sort=epss_desc", headers=headers)
        assert resp.status_code == 422
