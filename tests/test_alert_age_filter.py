"""Tests for age filtering on GET /api/v1/alerts/ and /api/v1/alerts/export."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_age_filter.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_age_filter.db"
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
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


NOW = datetime.now(UTC).replace(tzinfo=None)
AGES = {"fresh": timedelta(hours=12), "week": timedelta(days=3), "old": timedelta(days=10)}


def _seed_alerts(client: TestClient, headers) -> dict[str, int]:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    ids = {}
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        for label, age in AGES.items():
            alert = Alert(
                user_id=uid, asset_id=asset.id, title=f"{label} alert",
                severity="high", status="pending",
                created_at=NOW - age,
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            ids[label] = alert.id
    return ids


class TestAlertAgeFilter:
    def test_no_filter_returns_all(self, client):
        headers = _register_and_login(client, "all@example.com")
        _seed_alerts(client, headers)
        resp = client.get("/api/v1/alerts/", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 3

    def test_max_age_returns_newer_alerts(self, client):
        headers = _register_and_login(client, "max@example.com")
        ids = _seed_alerts(client, headers)
        resp = client.get("/api/v1/alerts/?max_age_days=1", headers=headers)
        assert resp.status_code == 200, resp.text
        got = {a["id"] for a in resp.json()["alerts"]}
        assert got == {ids["fresh"]}
        assert resp.json()["total"] == 1

    def test_min_age_returns_older_alerts(self, client):
        headers = _register_and_login(client, "min@example.com")
        ids = _seed_alerts(client, headers)
        resp = client.get("/api/v1/alerts/?min_age_days=7", headers=headers)
        assert resp.status_code == 200, resp.text
        got = {a["id"] for a in resp.json()["alerts"]}
        assert got == {ids["old"]}

    def test_age_range_returns_middle_bucket(self, client):
        headers = _register_and_login(client, "range@example.com")
        ids = _seed_alerts(client, headers)
        resp = client.get("/api/v1/alerts/?min_age_days=1&max_age_days=7", headers=headers)
        assert resp.status_code == 200, resp.text
        got = {a["id"] for a in resp.json()["alerts"]}
        assert got == {ids["week"]}

    def test_age_params_validated(self, client):
        headers = _register_and_login(client, "valid@example.com")
        assert client.get("/api/v1/alerts/?min_age_days=-1", headers=headers).status_code == 422
        assert client.get("/api/v1/alerts/?max_age_days=366", headers=headers).status_code == 422
        assert client.get("/api/v1/alerts/?max_age_days=abc", headers=headers).status_code == 422

    def test_export_honors_age_filter(self, client):
        headers = _register_and_login(client, "export@example.com")
        ids = _seed_alerts(client, headers)
        resp = client.get("/api/v1/alerts/export?min_age_days=7", headers=headers)
        assert resp.status_code == 200, resp.text
        rows = [line for line in resp.text.strip().splitlines()][1:]
        assert len(rows) == 1
        assert rows[0].startswith(f"{ids['old']},")

    def test_age_filter_scoped_to_owner(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        _seed_alerts(client, owner)
        resp = client.get("/api/v1/alerts/?min_age_days=0", headers=other)
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 0
