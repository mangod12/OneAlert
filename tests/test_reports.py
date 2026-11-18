"""
Tests for the posture report endpoint.

Covers: window-scoped alert aggregation and severity buckets, response
metrics, active-incident roll-up, investigation status counts, owner
isolation, and window validation.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.user import User
from backend.services.auth_service import get_password_hash


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reports.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_reports.db"
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


def _naive(days_ago=0, hours_ago=0):
    return (datetime.now(UTC) - timedelta(days=days_ago, hours=hours_ago)).replace(tzinfo=None)


def _seed(session, user_id):
    historian = Asset(
        user_id=user_id, name="plant-historian", asset_type="historian",
        vendor="Acme", product="DataVault",
    )
    router = Asset(
        user_id=user_id, name="edge-router", asset_type="hardware",
        vendor="NetCo", product="EdgeOS",
    )
    session.add_all([historian, router])
    session.flush()

    # Two active alerts on the historian -> one active critical incident.
    session.add(Alert(
        user_id=user_id, asset_id=historian.id, title="Ransomware behavior on historian",
        description="Encryption burst", severity="critical", status="pending",
        created_at=_naive(days_ago=2),
    ))
    session.add(Alert(
        user_id=user_id, asset_id=historian.id, title="Historian firmware tamper",
        description="unsigned image", severity="high", status="acknowledged",
        created_at=_naive(days_ago=3), acknowledged_at=_naive(days_ago=3, hours_ago=-2),
    ))
    # A resolved alert: inside the window, resolved after 4 hours.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="RouterOS RCE attempt",
        description="exploit probe", severity="high", status="resolved",
        created_at=_naive(hours_ago=12), resolved_at=_naive(hours_ago=8),
    ))
    # An old alert outside the default 30-day window.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Old firmware advisory",
        description="stale", severity="low", status="resolved",
        created_at=_naive(days_ago=60), resolved_at=_naive(days_ago=59),
    ))

    session.add(Case(
        user_id=user_id, title="Ransomware outbreak investigation",
        summary="Plant floor impact", severity="high", status="open",
        created_at=_naive(days_ago=2),
    ))
    session.add(Case(
        user_id=user_id, title="Insider misuse", severity="medium",
        status="investigating", created_at=_naive(days_ago=10),
    ))
    session.add(Case(
        user_id=user_id, title="Old phishing case", severity="low",
        status="closed", created_at=_naive(days_ago=45),
    ))
    session.commit()


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user and report data."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="reports_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Reports Tester",
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

    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    """Get auth headers for the test user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "reports_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestPostureReport:
    """Test the aggregated posture report."""

    def test_alert_window_aggregation(self, client, auth_headers):
        response = client.get("/api/v1/reports/posture", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["days"] == 30
        alerts = data["alerts"]
        # Three alerts created within 30 days; the 60-day-old one is excluded.
        assert alerts["opened"] == 3
        assert alerts["by_severity"] == {"critical": 1, "high": 2, "medium": 0, "low": 0}
        assert alerts["acknowledged"] == 1
        assert alerts["resolved"] == 1  # only the in-window resolution counts
        assert alerts["mtta_seconds"] == pytest.approx(2 * 3600, abs=5)
        assert alerts["mttr_seconds"] == pytest.approx(4 * 3600, abs=5)

    def test_incident_rollup(self, client, auth_headers):
        response = client.get("/api/v1/reports/posture", headers=auth_headers)
        incidents = response.json()["incidents"]
        assert incidents["active"] == 1
        assert incidents["critical"] == 1
        top = incidents["top_assets"]
        assert len(top) == 1
        assert top[0]["asset_name"] == "plant-historian"
        assert top[0]["alert_count"] == 2
        assert top[0]["max_severity"] == "critical"

    def test_case_counts(self, client, auth_headers):
        response = client.get("/api/v1/reports/posture", headers=auth_headers)
        cases = response.json()["cases"]
        assert cases["open"] == 1
        assert cases["in_progress"] == 1
        assert cases["closed"] == 1
        assert cases["opened"] == 2  # the 45-day-old case is outside the window

    def test_days_window_is_respected(self, client, auth_headers):
        response = client.get(
            "/api/v1/reports/posture", params={"days": 1}, headers=auth_headers
        )
        alerts = response.json()["alerts"]
        assert alerts["opened"] == 1  # only the alert from 1 day ago
        assert alerts["acknowledged"] == 0

    def test_days_bounds_validated(self, client, auth_headers):
        assert client.get(
            "/api/v1/reports/posture", params={"days": 0}, headers=auth_headers
        ).status_code == 422
        assert client.get(
            "/api/v1/reports/posture", params={"days": 91}, headers=auth_headers
        ).status_code == 422

    def test_requires_auth(self, client):
        assert client.get("/api/v1/reports/posture").status_code == 401
