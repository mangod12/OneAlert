"""
Tests for SLA breach notifications on overdue investigations.

Covers: the periodic notify_breached_slas service (which cases notify,
one-shot marking, audit trail) and re-arming when a due date moves.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert  # noqa: F401  (mapper dependency)
from backend.models.audit_log import AuditLog
from backend.models.case import Case
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.auth_service import get_password_hash
from backend.services.sla import notify_breached_slas

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_sla_breach.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_sla_breach.db"
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
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="sla_breach@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="SLA Tester",
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


def _user_id() -> int:
    with TestingSessionLocal() as session:
        return session.execute(
            select(User.id).where(User.email == "sla_breach@example.com")
        ).scalar_one()


def _seed_cases(user_id: int, cases: list[dict]) -> list[int]:
    with TestingSessionLocal() as session:
        ids = []
        for spec in cases:
            case = Case(user_id=user_id, **spec)
            session.add(case)
            session.flush()
            ids.append(case.id)
        session.commit()
    return ids


class TestNotifyBreachedSlas:
    @pytest.mark.asyncio
    async def test_overdue_open_case_notifies_once_with_audit(self, client):
        uid = _user_id()
        (case_id,) = _seed_cases(uid, [
            {"title": "Ransomware on historian", "severity": "critical",
             "status": "open", "due_date": YESTERDAY},
        ])
        async with AsyncTestingSessionLocal() as session:
            sent = await notify_breached_slas(session)
            assert sent == 1
            notification = (await session.execute(
                select(Notification).where(
                    Notification.user_id == uid, Notification.kind == "case_sla_breached"
                )
            )).scalar_one()
            assert "Ransomware on historian" in notification.title
            assert notification.link == f"/app/cases/{case_id}"
            assert "1 day ago" in notification.body
            audit = (await session.execute(
                select(AuditLog).where(AuditLog.action == "case_sla_breached")
            )).scalar_one()
            assert audit.target_id == case_id
            case = await session.get(Case, case_id)
            assert case.sla_breach_notified_at is not None

            # A second run must not duplicate the notification.
            assert await notify_breached_slas(session) == 0
            count = (await session.execute(
                select(Notification).where(Notification.kind == "case_sla_breached")
            )).scalars().all()
            assert len(count) == 1
            await session.rollback()

    @pytest.mark.asyncio
    async def test_investigating_case_also_notifies(self, client):
        uid = _user_id()
        _seed_cases(uid, [
            {"title": "Being worked", "severity": "high",
             "status": "investigating", "due_date": YESTERDAY},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_breached_slas(session) == 1
            await session.rollback()

    @pytest.mark.asyncio
    async def test_done_future_and_unscheduled_cases_are_skipped(self, client):
        uid = _user_id()
        _seed_cases(uid, [
            {"title": "resolved", "severity": "high", "status": "resolved", "due_date": YESTERDAY},
            {"title": "closed", "severity": "high", "status": "closed", "due_date": YESTERDAY},
            {"title": "false positive", "severity": "high", "status": "false_positive", "due_date": YESTERDAY},
            {"title": "future", "severity": "high", "status": "open", "due_date": TOMORROW},
            {"title": "no due date", "severity": "high", "status": "open"},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_breached_slas(session) == 0
            await session.rollback()


class TestDueDateChangeRearms:
    def test_moving_due_date_rearms_notification(self, client):
        uid = _user_id()
        (case_id,) = _seed_cases(uid, [
            {"title": "Will breach", "severity": "high", "status": "open",
             "due_date": YESTERDAY,
             "sla_breach_notified_at": datetime.now(UTC)},
        ])
        login = client.post("/api/v1/auth/login", data={
            "username": "sla_breach@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        # Extending the due date clears the breach marker.
        resp = client.patch(
            f"/api/v1/cases/{case_id}", params={"due_date": TOMORROW.isoformat()},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        with TestingSessionLocal() as session:
            assert session.get(Case, case_id).sla_breach_notified_at is None

    def test_clearing_due_date_rearms_notification(self, client):
        uid = _user_id()
        (case_id,) = _seed_cases(uid, [
            {"title": "Will breach too", "severity": "high", "status": "open",
             "due_date": YESTERDAY,
             "sla_breach_notified_at": datetime.now(UTC)},
        ])
        login = client.post("/api/v1/auth/login", data={
            "username": "sla_breach@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        resp = client.patch(
            f"/api/v1/cases/{case_id}", params={"due_date": ""}, headers=headers,
        )
        assert resp.status_code == 200, resp.text
        with TestingSessionLocal() as session:
            case = session.get(Case, case_id)
            assert case.due_date is None
            assert case.sla_breach_notified_at is None
