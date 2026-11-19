"""
Tests for the SLA compliance report endpoint.

Covers: met/breached scoring for alerts and investigations due inside the
window, severity buckets, upcoming (not yet due) counts, attainment
percentage, window validation, and owner isolation.
"""

from datetime import UTC, date, datetime, timedelta

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


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reports_sla.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_reports_sla.db"
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


TODAY = date.today()


def _naive(days_ago=0):
    return (datetime.now(UTC) - timedelta(days=days_ago)).replace(tzinfo=None)


def _seed(session, user_id):
    router = Asset(
        user_id=user_id, name="edge-router", asset_type="hardware",
        vendor="NetCo", product="EdgeOS",
    )
    session.add(router)
    session.flush()

    # Met: due yesterday, resolved two days ago.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Patched on time",
        description="met", severity="critical", status="resolved",
        created_at=_naive(days_ago=4), due_date=TODAY - timedelta(days=1),
        resolved_at=_naive(days_ago=2),
    ))
    # Breached: due five days ago, still open.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Overdue triage",
        description="breached", severity="high", status="pending",
        created_at=_naive(days_ago=6), due_date=TODAY - timedelta(days=5),
    ))
    # Breached: due three days ago, resolved only yesterday.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Late patch",
        description="breached", severity="high", status="resolved",
        created_at=_naive(days_ago=6), due_date=TODAY - timedelta(days=3),
        resolved_at=_naive(days_ago=1),
    ))
    # Upcoming: due in three days, not scored.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Future triage",
        description="upcoming", severity="low", status="acknowledged",
        created_at=_naive(days_ago=1), due_date=TODAY + timedelta(days=3),
    ))
    # Outside the window: due 60 days ago.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Ancient alert",
        description="out of window", severity="medium", status="resolved",
        created_at=_naive(days_ago=65), due_date=TODAY - timedelta(days=60),
        resolved_at=_naive(days_ago=61),
    ))

    # Met case: closed before its due date (updated_at set on the close).
    session.add(Case(
        user_id=user_id, title="Closed in time", severity="high", status="closed",
        created_at=_naive(days_ago=4), updated_at=_naive(days_ago=2),
        due_date=TODAY - timedelta(days=1),
    ))
    # Breached case: still open past its due date.
    session.add(Case(
        user_id=user_id, title="Overdue investigation", severity="medium",
        status="investigating", created_at=_naive(days_ago=8),
        due_date=TODAY - timedelta(days=2),
    ))
    # Upcoming case: due in five days.
    session.add(Case(
        user_id=user_id, title="Upcoming investigation", severity="low",
        status="open", created_at=_naive(days_ago=1),
        due_date=TODAY + timedelta(days=5),
    ))
    session.commit()


@pytest.fixture(scope="function")
def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="sla_report_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="SLA Tester",
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
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "sla_report_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestSlaComplianceReport:
    def test_alert_scoring(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        assert response.status_code == 200
        alerts = response.json()["alerts"]
        assert alerts["due"] == 3
        assert alerts["met"] == 1
        assert alerts["breached"] == 2
        assert alerts["upcoming"] == 1
        assert alerts["attainment_pct"] == pytest.approx(33.3, abs=0.1)
        assert alerts["by_severity"]["critical"] == {"due": 1, "met": 1, "breached": 0}
        assert alerts["by_severity"]["high"] == {"due": 2, "met": 0, "breached": 2}
        assert alerts["by_severity"]["medium"] == {"due": 0, "met": 0, "breached": 0}

    def test_case_scoring(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        cases = response.json()["cases"]
        assert cases["due"] == 2
        assert cases["met"] == 1
        assert cases["breached"] == 1
        assert cases["upcoming"] == 1
        assert cases["attainment_pct"] == pytest.approx(50.0, abs=0.1)
        assert cases["by_severity"]["high"] == {"due": 1, "met": 1, "breached": 0}
        assert cases["by_severity"]["medium"] == {"due": 1, "met": 0, "breached": 1}

    def test_window_is_respected(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla?days=90", headers=auth_headers)
        alerts = response.json()["alerts"]
        # The 60-day-old alert joins the scored cohort at a 90-day window.
        assert alerts["due"] == 4
        assert alerts["met"] == 2

    def test_window_validation(self, client, auth_headers):
        assert client.get("/api/v1/reports/sla?days=0", headers=auth_headers).status_code == 422
        assert client.get("/api/v1/reports/sla?days=91", headers=auth_headers).status_code == 422

    def test_requires_auth(self, client):
        assert client.get("/api/v1/reports/sla").status_code == 401

    def test_owner_isolation(self, client, auth_headers):
        with TestingSessionLocal() as session:
            other = User(
                email="sla_other@example.com",
                hashed_password=get_password_hash("testpass123"),
                full_name="Other", company="Other Corp",
                is_active=True, is_verified=True,
            )
            session.add(other)
            session.commit()
            session.refresh(other)
            asset = Asset(
                user_id=other.id, name="other-router", asset_type="hardware",
                vendor="NetCo", product="EdgeOS",
            )
            session.add(asset)
            session.flush()
            session.add(Alert(
                user_id=other.id, asset_id=asset.id, title="Not yours",
                description="other owner", severity="critical", status="pending",
                created_at=_naive(days_ago=2), due_date=TODAY - timedelta(days=1),
            ))
            session.commit()
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        # The other owner's overdue alert must not leak into this report.
        assert response.json()["alerts"]["due"] == 3
