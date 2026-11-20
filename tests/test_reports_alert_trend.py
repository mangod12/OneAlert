"""Tests for the alert volume trend endpoint (GET /api/v1/reports/alert-trend)."""

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
from backend.models.user import User
from backend.services.auth_service import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reports_alert_trend.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_reports_alert_trend.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session


TODAY = datetime.now(UTC).date()

@pytest.fixture(autouse=True)
def stable_utc_clock(monkeypatch):
    """Keep imported date fixtures and the exercised clock on the same UTC day.

    CI can collect before midnight and run these tests after midnight. Freeze
    both fixture timestamps and the service clock to noon on the collected day.
    """
    import importlib
    import sys

    fixed = datetime.combine(TODAY, datetime.min.time(), tzinfo=UTC).replace(hour=12)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz is not None else fixed.replace(tzinfo=None)

    monkeypatch.setattr(importlib.import_module("backend.routers.reports"), "datetime", FrozenDateTime)
    monkeypatch.setattr(sys.modules[__name__], "datetime", FrozenDateTime)



def _naive(days_ago=0):
    return (datetime.now(UTC) - timedelta(days=days_ago)).replace(tzinfo=None)


def _seed(session, user_id):
    asset = Asset(user_id=user_id, name="edge-router", asset_type="hardware")
    session.add(asset)
    session.flush()
    # Opened 2 days ago, resolved yesterday.
    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Resolved pair",
        severity="high", status="resolved",
        created_at=_naive(days_ago=2), resolved_at=_naive(days_ago=1),
    ))
    # Opened today, still open.
    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Fresh alert",
        severity="medium", status="pending", created_at=_naive(days_ago=0),
    ))
    # Opened 40 days ago: outside the default 30-day window.
    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Ancient alert",
        severity="low", status="resolved",
        created_at=_naive(days_ago=40), resolved_at=_naive(days_ago=39),
    ))
    session.commit()


@pytest.fixture(scope="function")
def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as session:
        user = User(
            email="trend@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Trend Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        _seed(session, user.id)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "trend@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_trend_series_shape_and_counts(client, auth_headers):
    resp = client.get("/api/v1/reports/alert-trend", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["days"] == 30
    series = body["series"]
    assert len(series) == 30
    assert series[0]["date"] == (TODAY - timedelta(days=29)).isoformat()
    assert series[-1]["date"] == TODAY.isoformat()

    by_date = {row["date"]: row for row in series}
    two_days_ago = (TODAY - timedelta(days=2)).isoformat()
    yesterday = (TODAY - timedelta(days=1)).isoformat()
    assert by_date[two_days_ago]["opened"] == 1
    assert by_date[two_days_ago]["resolved"] == 0
    assert by_date[yesterday]["resolved"] == 1
    assert by_date[TODAY.isoformat()]["opened"] == 1
    # Quiet days are zero-filled.
    quiet = (TODAY - timedelta(days=10)).isoformat()
    assert by_date[quiet] == {"date": quiet, "opened": 0, "resolved": 0}
    # The 40-day-old alert is outside the window.
    assert sum(r["opened"] for r in series) == 2
    assert sum(r["resolved"] for r in series) == 1


def test_trend_respects_window_param(client, auth_headers):
    resp = client.get("/api/v1/reports/alert-trend", params={"days": 7}, headers=auth_headers)
    assert resp.status_code == 200
    series = resp.json()["series"]
    assert len(series) == 7
    assert series[0]["date"] == (TODAY - timedelta(days=6)).isoformat()


def test_trend_excludes_other_users_alerts(client, auth_headers):
    with TestingSessionLocal() as session:
        other = User(
            email="other@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Other",
            company="Other Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(other)
        session.commit()
        session.refresh(other)
        asset = Asset(user_id=other.id, name="foreign", asset_type="hardware")
        session.add(asset)
        session.flush()
        session.add(Alert(
            user_id=other.id, asset_id=asset.id, title="Not yours",
            severity="critical", status="pending", created_at=_naive(days_ago=0),
        ))
        session.commit()

    resp = client.get("/api/v1/reports/alert-trend", headers=auth_headers)
    assert resp.status_code == 200
    series = resp.json()["series"]
    assert sum(r["opened"] for r in series) == 2  # only the owner's alerts


def test_trend_window_validation(client, auth_headers):
    assert client.get("/api/v1/reports/alert-trend", params={"days": 0}, headers=auth_headers).status_code == 422
    assert client.get("/api/v1/reports/alert-trend", params={"days": 91}, headers=auth_headers).status_code == 422


def test_trend_requires_auth(client):
    assert client.get("/api/v1/reports/alert-trend").status_code == 401
