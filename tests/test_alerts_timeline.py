"""Tests for GET /api/v1/alerts/stats/timeline - per-day severity counts."""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alerts_timeline.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alerts_timeline.db"
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
    Base.metadata.drop_all(bind=_engine)
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


def _seed_alert(client: TestClient, headers, severity: str, days_ago: float):
    me = client.get("/api/v1/auth/me", headers=headers)
    user_id = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = db.query(Asset).filter_by(user_id=user_id).first()
        if asset is None:
            asset = Asset(user_id=user_id, name="edge-router", asset_type="hardware")
            db.add(asset)
            db.flush()
        db.add(Alert(
            user_id=user_id,
            asset_id=asset.id,
            cve_id=f"CVE-2026-{severity[:2]}{int(days_ago * 10)}",
            title=f"{severity} alert",
            severity=severity,
            status="pending",
            created_at=datetime.now(UTC) - timedelta(days=days_ago),
        ))
        db.commit()


class TestAlertTimeline:
    def test_counts_per_day_and_severity(self, client):
        headers = _register_and_login(client, "tl1@example.com")
        _seed_alert(client, headers, "critical", 0)
        _seed_alert(client, headers, "critical", 1)
        _seed_alert(client, headers, "low", 1)
        _seed_alert(client, headers, "medium", 13)

        res = client.get("/api/v1/alerts/stats/timeline?days=14", headers=headers)
        assert res.status_code == 200, res.text
        days = res.json()["days"]
        assert len(days) == 14
        today = datetime.now(UTC).date()
        assert days[-1]["date"] == today.isoformat()
        assert days[-1]["critical"] == 1
        yesterday = (today - timedelta(days=1)).isoformat()
        y = next(d for d in days if d["date"] == yesterday)
        assert y["critical"] == 1
        assert y["low"] == 1
        oldest = days[0]
        assert oldest["date"] == (today - timedelta(days=13)).isoformat()
        assert oldest["medium"] == 1
        # Empty days are zero-filled
        empty = next(d for d in days if d["date"] == (today - timedelta(days=5)).isoformat())
        assert empty == {"date": empty["date"], "critical": 0, "high": 0, "medium": 0, "low": 0}

    def test_alerts_outside_window_excluded(self, client):
        headers = _register_and_login(client, "tl2@example.com")
        _seed_alert(client, headers, "high", 20)

        days = client.get("/api/v1/alerts/stats/timeline?days=7", headers=headers).json()["days"]
        assert len(days) == 7
        assert sum(d["high"] for d in days) == 0

    def test_days_parameter_bounds(self, client):
        headers = _register_and_login(client, "tl3@example.com")
        assert client.get("/api/v1/alerts/stats/timeline?days=0", headers=headers).status_code == 422
        assert client.get("/api/v1/alerts/stats/timeline?days=91", headers=headers).status_code == 422
        assert client.get("/api/v1/alerts/stats/timeline?days=30", headers=headers).status_code == 200

    def test_only_own_alerts_counted(self, client):
        owner = _register_and_login(client, "tl-owner@example.com")
        other = _register_and_login(client, "tl-other@example.com")
        _seed_alert(client, owner, "critical", 0)

        days = client.get("/api/v1/alerts/stats/timeline", headers=other).json()["days"]
        assert sum(d["critical"] for d in days) == 0
