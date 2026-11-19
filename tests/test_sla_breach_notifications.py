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
from backend.models.organization import Organization
from backend.models.user import User
from backend.services.auth_service import get_password_hash
from backend.services.sla import (
    notify_breached_alert_slas,
    notify_breached_slas,
    notify_due_soon_slas,
)

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


class TestNotifyDueSoonSlas:
    @pytest.mark.asyncio
    async def test_case_due_tomorrow_warns_once_with_audit(self, client):
        uid = _user_id()
        (case_id,) = _seed_cases(uid, [
            {"title": "Firmware audit", "severity": "high",
             "status": "open", "due_date": TOMORROW},
        ])
        async with AsyncTestingSessionLocal() as session:
            sent = await notify_due_soon_slas(session)
            assert sent == 1
            notification = (await session.execute(
                select(Notification).where(
                    Notification.user_id == uid, Notification.kind == "case_sla_due_soon"
                )
            )).scalar_one()
            assert "Firmware audit" in notification.title
            assert "due tomorrow" in notification.title
            assert notification.link == f"/app/cases/{case_id}"
            audit = (await session.execute(
                select(AuditLog).where(AuditLog.action == "case_sla_due_soon")
            )).scalar_one()
            assert audit.target_id == case_id
            case = await session.get(Case, case_id)
            assert case.sla_due_soon_notified_at is not None

            # A second run must not duplicate the warning.
            assert await notify_due_soon_slas(session) == 0
            await session.rollback()

    @pytest.mark.asyncio
    async def test_today_later_done_and_unscheduled_cases_are_skipped(self, client):
        uid = _user_id()
        _seed_cases(uid, [
            {"title": "Due today", "severity": "high",
             "status": "open", "due_date": TODAY},
            {"title": "Due later", "severity": "high",
             "status": "open", "due_date": TOMORROW + timedelta(days=1)},
            {"title": "Already resolved", "severity": "high",
             "status": "resolved", "due_date": TOMORROW},
            {"title": "No date", "severity": "high",
             "status": "open", "due_date": None},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_slas(session) == 0

    @pytest.mark.asyncio
    async def test_breach_check_does_not_double_as_due_soon(self, client):
        uid = _user_id()
        _seed_cases(uid, [
            {"title": "Overdue already", "severity": "critical",
             "status": "open", "due_date": YESTERDAY},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_slas(session) == 0


class TestDueDateChangeRearmsDueSoon:
    def test_moving_due_date_rearms_due_soon_warning(self, client):
        uid = _user_id()
        (case_id,) = _seed_cases(uid, [
            {"title": "Warned once", "severity": "high", "status": "open",
             "due_date": TOMORROW,
             "sla_due_soon_notified_at": datetime.now(UTC)},
        ])
        login = client.post("/api/v1/auth/login", data={
            "username": "sla_breach@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        later = (TOMORROW + timedelta(days=2)).isoformat()
        resp = client.patch(
            f"/api/v1/cases/{case_id}", params={"due_date": later},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        with TestingSessionLocal() as session:
            assert session.get(Case, case_id).sla_due_soon_notified_at is None


def _second_user_id() -> int:
    with TestingSessionLocal() as session:
        user = User(
            email="sla_assignee@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="SLA Assignee",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user.id


class TestAssigneeSlaNotifications:
    @pytest.mark.asyncio
    async def test_breach_notifies_owner_and_assignee(self, client):
        owner = _user_id()
        assignee = _second_user_id()
        (case_id,) = _seed_cases(owner, [
            {"title": "Overdue investigation", "severity": "high",
             "status": "open", "due_date": YESTERDAY, "assigned_to_id": assignee},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_breached_slas(session) == 1
            rows = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_breached")
            )).scalars().all()
            assert sorted(rows) == sorted([owner, assignee])
            case = await session.get(Case, case_id)
            assert case.sla_breach_notified_at is not None
            await session.rollback()

    @pytest.mark.asyncio
    async def test_due_soon_notifies_owner_and_assignee(self, client):
        owner = _user_id()
        assignee = _second_user_id()
        _seed_cases(owner, [
            {"title": "Due tomorrow", "severity": "medium",
             "status": "investigating", "due_date": TOMORROW, "assigned_to_id": assignee},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_slas(session) == 1
            rows = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_due_soon")
            )).scalars().all()
            assert sorted(rows) == sorted([owner, assignee])
            await session.rollback()

    @pytest.mark.asyncio
    async def test_unassigned_case_notifies_only_owner(self, client):
        owner = _user_id()
        _seed_cases(owner, [
            {"title": "Unassigned overdue", "severity": "low",
             "status": "open", "due_date": YESTERDAY},
        ])
        async with AsyncTestingSessionLocal() as session:
            assert await notify_breached_slas(session) == 1
            rows = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_breached")
            )).scalars().all()
            assert rows == [owner]
            await session.rollback()


def _seed_org(owner_id: int, members: list[dict]) -> list[int]:
    """Put the owner and the given extra members into one org; return their ids."""
    with TestingSessionLocal() as session:
        org = Organization(name="Esc Org", slug="esc-org", plan="pro", max_assets=100, max_users=10)
        session.add(org)
        session.flush()
        session.get(User, owner_id).org_id = org.id
        ids = []
        for spec in members:
            member = User(
                email=spec["email"],
                hashed_password=get_password_hash("testpass123"),
                full_name="Esc Member",
                company="Test Corp",
                is_active=spec.get("is_active", True),
                is_verified=True,
                role=spec.get("role", "admin"),
                org_id=org.id,
            )
            session.add(member)
            session.flush()
            ids.append(member.id)
        session.commit()
        return ids


def _seed_org_admin(owner_id: int, email: str, role: str = "admin", is_active: bool = True) -> int:
    """Put the owner and one new member into an org; return the member's id."""
    return _seed_org(owner_id, [{"email": email, "role": role, "is_active": is_active}])[0]


class TestBreachEscalationToAdmins:
    @pytest.mark.asyncio
    async def test_case_breach_escalates_to_org_admin(self, client):
        uid = _user_id()
        admin_id = _seed_org_admin(uid, "escalation-admin@example.com")
        _seed_cases(uid, [dict(
            title="Overdue case", severity="high", status="open", due_date=YESTERDAY,
        )])
        async with AsyncTestingSessionLocal() as session:
            sent = await notify_breached_slas(session)
            assert sent == 1
            kinds = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_breached")
            )).scalars().all()
            assert sorted(kinds) == sorted([uid, admin_id])
            await session.rollback()

    @pytest.mark.asyncio
    async def test_inactive_admin_and_non_admin_are_skipped(self, client):
        uid = _user_id()
        _, analyst_id = _seed_org(uid, [
            {"email": "inactive-admin@example.com", "is_active": False},
            {"email": "analyst@example.com", "role": "analyst"},
        ])
        _seed_cases(uid, [dict(
            title="Overdue case", severity="high", status="open", due_date=YESTERDAY,
        )])
        async with AsyncTestingSessionLocal() as session:
            await notify_breached_slas(session)
            kinds = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_breached")
            )).scalars().all()
            assert kinds == [uid]
            await session.rollback()
        assert analyst_id != uid

    @pytest.mark.asyncio
    async def test_due_soon_does_not_escalate(self, client):
        uid = _user_id()
        _seed_org_admin(uid, "due-soon-admin@example.com")
        _seed_cases(uid, [dict(
            title="Due soon case", severity="high", status="open", due_date=TOMORROW,
        )])
        async with AsyncTestingSessionLocal() as session:
            await notify_due_soon_slas(session)
            kinds = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "case_sla_due_soon")
            )).scalars().all()
            assert kinds == [uid]
            await session.rollback()

    @pytest.mark.asyncio
    async def test_alert_breach_escalates_to_org_admin(self, client):
        from backend.models.asset import Asset

        uid = _user_id()
        admin_id = _seed_org_admin(uid, "alert-escalation-admin@example.com")
        with TestingSessionLocal() as session:
            asset = Asset(user_id=uid, name="edge-router", asset_type="hardware")
            session.add(asset)
            session.flush()
            session.add(Alert(
                user_id=uid, asset_id=asset.id, title="Overdue alert",
                severity="critical", status="pending", due_date=YESTERDAY,
            ))
            session.commit()
        async with AsyncTestingSessionLocal() as session:
            sent = await notify_breached_alert_slas(session)
            assert sent == 1
            kinds = (await session.execute(
                select(Notification.user_id).where(Notification.kind == "alert_sla_breached")
            )).scalars().all()
            assert sorted(kinds) == sorted([uid, admin_id])
            await session.rollback()
