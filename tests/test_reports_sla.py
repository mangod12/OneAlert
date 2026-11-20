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

    # Met case: recorded close-out occurred before its due date.
    session.add(Case(
        user_id=user_id, title="Closed in time", severity="high", status="closed",
        created_at=_naive(days_ago=4), closed_at=_naive(days_ago=2), updated_at=_naive(),
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
        assert alerts["by_severity"]["critical"] == {"due": 1, "met": 1, "breached": 0, "unknown": 0}
        assert alerts["by_severity"]["high"] == {"due": 2, "met": 0, "breached": 2, "unknown": 0}
        assert alerts["by_severity"]["medium"] == {"due": 0, "met": 0, "breached": 0, "unknown": 0}

    def test_case_scoring(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        cases = response.json()["cases"]
        assert cases["due"] == 2
        assert cases["met"] == 1
        assert cases["breached"] == 1
        assert cases["upcoming"] == 1
        assert cases["attainment_pct"] == pytest.approx(50.0, abs=0.1)
        assert cases["by_severity"]["high"] == {"due": 1, "met": 1, "breached": 0, "unknown": 0}
        assert cases["by_severity"]["medium"] == {"due": 1, "met": 0, "breached": 1, "unknown": 0}

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


def test_sla_keeps_unknown_completion_timing_separate_from_decided_outcomes(client, auth_headers):
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Legacy closed record', severity='critical', status='closed', due_date=TODAY - timedelta(days=1), updated_at=_naive(days_ago=2)))
        db.add(Case(user_id=user.id, title='Reopened with obsolete close time', severity='critical', status='open', due_date=TODAY - timedelta(days=1), closed_at=_naive(days_ago=2)))
        asset = db.query(Asset).filter_by(user_id=user.id).first()
        db.add(Alert(user_id=user.id, asset_id=asset.id, title='Legacy resolved alert', description='missing timing', severity='critical', status='resolved', due_date=TODAY - timedelta(days=1)))
        db.commit()
    result = client.get('/api/v1/reports/sla', headers=auth_headers).json()
    assert result['cases']['unknown'] == 1
    assert result['cases']['met'] == 1
    assert result['cases']['breached'] == 2
    assert result['cases']['attainment_pct'] == 33.3
    assert result['alerts']['unknown'] == 1
    assert result['alerts']['attainment_pct'] == 33.3
    for scope in ['cases', 'alerts']:
        bucket = result[scope]
        assert bucket['due'] == bucket['met'] + bucket['breached'] + bucket['unknown']


def test_sla_reports_no_score_when_all_completion_times_are_unknown(client, auth_headers):
    with TestingSessionLocal() as db:
        db.query(Case).delete()
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Closed without timing evidence', severity='high', status='closed', due_date=TODAY - timedelta(days=1), updated_at=_naive(days_ago=2)))
        db.commit()
    bucket = client.get('/api/v1/reports/sla', headers=auth_headers).json()['cases']
    assert bucket['unknown'] == bucket['due'] == 1
    assert bucket['met'] == bucket['breached'] == 0
    assert bucket['attainment_pct'] is None


def test_one_day_sla_window_does_not_include_yesterdays_due_dates(client, auth_headers):
    result = client.get('/api/v1/reports/sla?days=1', headers=auth_headers).json()
    assert result['cases']['due'] == 0
    assert result['alerts']['due'] == 0
