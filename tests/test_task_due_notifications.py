"""
Tests for due-date reminders on investigation checklist tasks.

Covers: the periodic notify_due_soon_tasks and notify_overdue_tasks
services (which tasks notify, one-shot marking, audit trail, skipping
done/unassigned/closed-case tasks) and re-arming when a due date moves.
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
from backend.models.case import Case, CaseTask
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.auth_service import get_password_hash
from backend.services.sla import notify_due_soon_tasks, notify_overdue_tasks

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_task_due_notifications.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_task_due_notifications.db"
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
            email="task_due@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Task Tester",
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
            select(User.id).where(User.email == "task_due@example.com")
        ).scalar_one()


def _seed_case(user_id: int, title="Beaconing host", status="open") -> int:
    with TestingSessionLocal() as session:
        case = Case(user_id=user_id, title=title, status=status, severity="high")
        session.add(case)
        session.commit()
        session.refresh(case)
        return case.id


def _seed_task(case_id: int, assignee_id: int | None, **kwargs) -> int:
    with TestingSessionLocal() as session:
        task = CaseTask(
            case_id=case_id,
            title=kwargs.pop("title", "Contain the host"),
            position=0,
            assignee_id=assignee_id,
            created_by_id=assignee_id,
            **kwargs,
        )
        session.add(task)
        session.commit()
        session.refresh(task)
        return task.id


class TestNotifyDueSoonTasks:
    @pytest.mark.asyncio
    async def test_task_due_tomorrow_reminds_assignee_once(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        _seed_task(case_id, uid, due_date=TOMORROW)
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_tasks(session) == 1
            notification = (await session.execute(
                select(Notification).where(
                    Notification.user_id == uid, Notification.kind == "case_task_due_soon"
                )
            )).scalar_one()
            assert "Contain the host" in notification.title
            assert notification.link == f"/app/cases/{case_id}"
            audit = (await session.execute(
                select(AuditLog).where(AuditLog.action == "case_task_due_soon")
            )).scalar_one()
            assert audit.target_id == case_id
            # A second run must not duplicate the reminder.
            assert await notify_due_soon_tasks(session) == 0
            await session.rollback()

    @pytest.mark.asyncio
    async def test_done_task_due_tomorrow_is_skipped(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        _seed_task(case_id, uid, due_date=TOMORROW, done=True,
                   completed_at=datetime.now(UTC))
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_tasks(session) == 0
            await session.rollback()

    @pytest.mark.asyncio
    async def test_unassigned_task_due_tomorrow_is_skipped(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        _seed_task(case_id, None, due_date=TOMORROW)
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_tasks(session) == 0
            await session.rollback()

    @pytest.mark.asyncio
    async def test_task_on_closed_case_is_skipped(self, client):
        uid = _user_id()
        case_id = _seed_case(uid, status="resolved")
        _seed_task(case_id, uid, due_date=TOMORROW)
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_tasks(session) == 0
            assert await notify_overdue_tasks(session) == 0
            await session.rollback()


class TestNotifyOverdueTasks:
    @pytest.mark.asyncio
    async def test_overdue_task_notifies_once_with_day_count(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        _seed_task(case_id, uid, due_date=YESTERDAY)
        async with AsyncTestingSessionLocal() as session:
            assert await notify_overdue_tasks(session) == 1
            notification = (await session.execute(
                select(Notification).where(
                    Notification.user_id == uid, Notification.kind == "case_task_overdue"
                )
            )).scalar_one()
            assert "1 day ago" in notification.body
            assert notification.link == f"/app/cases/{case_id}"
            assert await notify_overdue_tasks(session) == 0
            await session.rollback()

    @pytest.mark.asyncio
    async def test_done_overdue_task_is_skipped(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        _seed_task(case_id, uid, due_date=YESTERDAY, done=True,
                   completed_at=datetime.now(UTC))
        async with AsyncTestingSessionLocal() as session:
            assert await notify_overdue_tasks(session) == 0
            await session.rollback()


class TestMarkerRearm:
    @pytest.mark.asyncio
    async def test_moving_due_date_rearms_reminders(self, client):
        uid = _user_id()
        case_id = _seed_case(uid)
        task_id = _seed_task(case_id, uid, due_date=YESTERDAY)
        async with AsyncTestingSessionLocal() as session:
            assert await notify_overdue_tasks(session) == 1
            await session.rollback()

        # Move the due date forward through the API; markers reset.
        login = client.post("/api/v1/auth/login", data={
            "username": "task_due@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = client.patch(
            f"/api/v1/cases/{case_id}/tasks/{task_id}",
            json={"due_date": TOMORROW.isoformat()},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        with TestingSessionLocal() as session:
            task = session.get(CaseTask, task_id)
            assert task.overdue_notified_at is None
            assert task.due_soon_notified_at is None

        # The re-armed due-soon reminder fires once for the new date.
        async with AsyncTestingSessionLocal() as session:
            assert await notify_due_soon_tasks(session) == 1
            await session.rollback()
