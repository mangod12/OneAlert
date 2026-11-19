"""
Tests for incident auto-escalation.

Covers: automation preferences endpoint, threshold and severity gating in
the alert checker, case creation with linked alerts, and deduplication
when an open investigation already covers the incident.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.alert_checker import _maybe_auto_escalate
from backend.services.auth_service import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_auto_escalation.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_auto_escalation.db"
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


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="autoesc_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Escalation Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()

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
        data={"username": "autoesc_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestAutomationPreferences:
    def test_defaults(self, client, auth_headers):
        response = client.get("/api/v1/auth/me/automation-preferences", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == {
            "auto_escalate_incidents": False,
            "auto_escalate_min_alerts": 3,
            "auto_escalate_min_severity": "high",
            "sla_due_dates_enabled": False,
            "auto_assign_new_alerts": False,
            "sla_days_critical": 1,
            "sla_days_high": 3,
            "sla_days_medium": 7,
            "sla_days_low": 14,
            "sla_days_info": 30,
        }

    def test_update_roundtrip(self, client, auth_headers):
        response = client.patch(
            "/api/v1/auth/me/automation-preferences", headers=auth_headers,
            json={"auto_escalate_incidents": True, "auto_escalate_min_alerts": 4,
                  "auto_escalate_min_severity": "critical"},
        )
        assert response.status_code == 200
        assert response.json()["auto_escalate_incidents"] is True
        assert response.json()["auto_escalate_min_alerts"] == 4
        assert response.json()["auto_escalate_min_severity"] == "critical"
        again = client.get("/api/v1/auth/me/automation-preferences", headers=auth_headers)
        assert again.json()["auto_escalate_min_alerts"] == 4

    def test_validation(self, client, auth_headers):
        assert client.patch(
            "/api/v1/auth/me/automation-preferences", headers=auth_headers,
            json={"auto_escalate_min_alerts": 1},
        ).status_code == 422
        assert client.patch(
            "/api/v1/auth/me/automation-preferences", headers=auth_headers,
            json={"auto_escalate_min_severity": "extreme"},
        ).status_code == 422


def _seed_incident(user_id: int, alerts: list[tuple[str, str]], escalations: dict | None = None):
    """Seed an asset with (title, severity) alerts; optionally enable auto-escalation."""
    with TestingSessionLocal() as session:
        user = session.get(User, user_id)
        for field, value in (escalations or {}).items():
            setattr(user, field, value)
        asset = Asset(user_id=user_id, name="plc-01", asset_type="hardware")
        session.add(asset)
        session.flush()
        asset_id = asset.id
        for title, severity in alerts:
            session.add(Alert(
                user_id=user_id, asset_id=asset_id, title=title,
                description="t", severity=severity, status="pending",
            ))
        session.commit()
    return asset_id


def _user_id() -> int:
    with TestingSessionLocal() as session:
        return session.execute(
            select(User.id).where(User.email == "autoesc_test@example.com")
        ).scalar_one()


class TestCheckerAutoEscalation:
    @pytest.mark.asyncio
    async def test_escalates_over_threshold(self, client, auth_headers):
        uid = _user_id()
        asset_id = _seed_incident(
            uid,
            [("a1", "critical"), ("a2", "high"), ("a3", "medium")],
            {"auto_escalate_incidents": True},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            case = (await session.execute(select(Case).where(Case.user_id == uid))).scalar_one()
            assert case.title == "Incident on plc-01"
            assert case.severity == "critical"
            assert "Auto-escalated" in case.summary
            linked = (await session.execute(
                select(CaseAlert).where(CaseAlert.case_id == case.id)
            )).scalars().all()
            assert len(linked) == 3
            notification = (await session.execute(
                select(Notification).where(
                    Notification.user_id == uid, Notification.kind == "incident_escalated"
                )
            )).scalar_one()
            assert notification.link == f"/app/cases/{case.id}"
            await session.rollback()

    @pytest.mark.asyncio
    async def test_no_second_case_for_same_incident(self, client, auth_headers):
        uid = _user_id()
        asset_id = _seed_incident(
            uid,
            [("a1", "critical"), ("a2", "high"), ("a3", "high"), ("a4", "high")],
            {"auto_escalate_incidents": True},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            await _maybe_auto_escalate(session, user, asset)  # a later alert retries
            cases = (await session.execute(select(Case).where(Case.user_id == uid))).scalars().all()
            assert len(cases) == 1
            await session.rollback()

    @pytest.mark.asyncio
    async def test_below_alert_threshold_does_nothing(self, client, auth_headers):
        uid = _user_id()
        # Only 2 active alerts (below default 3).
        asset_id = _seed_incident(
            uid, [("a1", "critical"), ("a2", "high")], {"auto_escalate_incidents": True}
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            assert (await session.execute(select(Case).where(Case.user_id == uid))).scalars().all() == []
            await session.rollback()

    @pytest.mark.asyncio
    async def test_below_severity_threshold_does_nothing(self, client, auth_headers):
        uid = _user_id()
        # 3 alerts but max severity medium, below the default high threshold.
        asset_id = _seed_incident(
            uid, [("b1", "medium"), ("b2", "medium"), ("b3", "low")],
            {"auto_escalate_incidents": True},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            assert (await session.execute(select(Case).where(Case.user_id == uid))).scalars().all() == []
            await session.rollback()

    @pytest.mark.asyncio
    async def test_disabled_by_default(self, client, auth_headers):
        uid = _user_id()
        asset_id = _seed_incident(uid, [("a1", "critical"), ("a2", "critical"), ("a3", "critical")])
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            assert (await session.execute(select(Case).where(Case.user_id == uid))).scalars().all() == []
            await session.rollback()


    @pytest.mark.asyncio
    async def test_escalated_case_gets_sla_due_date(self, client, auth_headers):
        uid = _user_id()
        asset_id = _seed_incident(
            uid,
            [("a1", "critical"), ("a2", "high"), ("a3", "high")],
            {"auto_escalate_incidents": True, "sla_due_dates_enabled": True,
             "sla_days_critical": 2},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            case = (await session.execute(select(Case).where(Case.user_id == uid))).scalar_one()
            assert case.severity == "critical"
            assert case.due_date == datetime.now(UTC).date() + timedelta(days=2)
            await session.rollback()

    @pytest.mark.asyncio
    async def test_escalated_case_has_no_due_date_when_sla_disabled(self, client, auth_headers):
        uid = _user_id()
        asset_id = _seed_incident(
            uid,
            [("a1", "critical"), ("a2", "high"), ("a3", "high")],
            {"auto_escalate_incidents": True},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            await _maybe_auto_escalate(session, user, asset)
            case = (await session.execute(select(Case).where(Case.user_id == uid))).scalar_one()
            assert case.due_date is None
            await session.rollback()


    @pytest.mark.asyncio
    async def test_investigating_case_blocks_escalation(self, client, auth_headers):
        """An investigation in the 'investigating' status also deduplicates."""
        uid = _user_id()
        asset_id = _seed_incident(
            uid,
            [("a1", "critical"), ("a2", "high"), ("a3", "high")],
            {"auto_escalate_incidents": True},
        )
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            asset = await session.get(Asset, asset_id)
            existing = Case(user_id=uid, title="Already on it", severity="high",
                            status="investigating")
            session.add(existing)
            await session.flush()
            alert_ids = (await session.execute(
                select(Alert.id).where(Alert.user_id == uid)
            )).scalars().all()
            for aid in alert_ids:
                session.add(CaseAlert(case_id=existing.id, alert_id=aid))
            await session.commit()

            await _maybe_auto_escalate(session, user, asset)
            cases = (await session.execute(select(Case).where(Case.user_id == uid))).scalars().all()
            assert len(cases) == 1
            assert cases[0].title == "Already on it"
            await session.rollback()
