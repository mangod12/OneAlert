"""
Tests for the daily digest email.

Covers: digest content (open/investigating/overdue counts, fresh urgent
alerts), the hourly send gate (opt-in, chosen UTC hour, email enabled),
skipping quiet users with an empty queue, and the preference endpoint.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.user import User
from backend.services.auth_service import get_password_hash
from backend.services.digest import _is_empty, build_digest, render_digest, send_due_digests
from backend.services.email_alert import email_service

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_daily_digest.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_daily_digest.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)

TODAY = datetime.now(UTC).date()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)


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
            email="digest@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Digest Tester",
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
            select(User.id).where(User.email == "digest@example.com")
        ).scalar_one()


def _set_prefs(**fields) -> None:
    with TestingSessionLocal() as session:
        user = session.get(User, _user_id())
        for field, value in fields.items():
            setattr(user, field, value)
        session.commit()


def _seed_work(user_id: int) -> None:
    """Two active cases (one overdue) and two urgent fresh alerts."""
    with TestingSessionLocal() as session:
        asset = Asset(user_id=user_id, name="edge-01", asset_type="hardware")
        session.add(asset)
        session.flush()
        session.add(Case(user_id=user_id, title="Overdue case", severity="high",
                         status="open", due_date=YESTERDAY))
        session.add(Case(user_id=user_id, title="Being worked", severity="medium",
                         status="investigating"))
        session.add(Case(user_id=user_id, title="Done", severity="low", status="resolved"))
        session.add(Alert(user_id=user_id, asset_id=asset.id, title="c1",
                          description="t", severity="critical", status="pending"))
        session.add(Alert(user_id=user_id, asset_id=asset.id, title="h1",
                          description="t", severity="high", status="pending"))
        session.add(Alert(user_id=user_id, asset_id=asset.id, title="l1",
                          description="t", severity="low", status="pending"))
        session.commit()


class TestBuildDigest:
    @pytest.mark.asyncio
    async def test_counts_and_overdue_list(self, client):
        uid = _user_id()
        _seed_work(uid)
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            digest = await build_digest(session, user)
            await session.rollback()
        assert digest["open"] == 1
        assert digest["investigating"] == 1
        assert digest["new_urgent_alerts"] == 2
        assert digest["overdue"] == [
            {"title": "Overdue case", "due_date": YESTERDAY.isoformat(), "severity": "high"}
        ]
        rendered = render_digest(digest)
        assert "Open investigations: 1" in rendered
        assert "Overdue case" in rendered


class TestSendDueDigests:
    @pytest.mark.asyncio
    async def test_sends_at_the_users_hour(self, client):
        uid = _user_id()
        _seed_work(uid)
        _set_prefs(digest_enabled=True, digest_hour_utc=6)
        at_six = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await send_due_digests(session, now=at_six) == 1
                await session.rollback()
        send.assert_awaited_once()
        assert send.await_args.kwargs["title"] == "Your daily OneAlert digest"

    @pytest.mark.asyncio
    async def test_skips_other_hours_and_opted_out(self, client):
        uid = _user_id()
        _seed_work(uid)
        _set_prefs(digest_enabled=True, digest_hour_utc=6)
        at_seven = datetime(2026, 11, 19, 7, 30, tzinfo=UTC)
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await send_due_digests(session, now=at_seven) == 0
                await session.rollback()
        send.assert_not_awaited()

        _set_prefs(digest_enabled=False)
        at_six = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await send_due_digests(session, now=at_six) == 0
                await session.rollback()
        send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_empty_queue_gets_no_email(self, client):
        _set_prefs(digest_enabled=True, digest_hour_utc=6)
        at_six = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await send_due_digests(session, now=at_six) == 0
                await session.rollback()
        send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_respects_email_notifications_toggle(self, client):
        uid = _user_id()
        _seed_work(uid)
        _set_prefs(digest_enabled=True, digest_hour_utc=6, email_notifications_enabled=False)
        at_six = datetime(2026, 11, 19, 6, 30, tzinfo=UTC)
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await send_due_digests(session, now=at_six) == 0
                await session.rollback()
        send.assert_not_awaited()


class TestDigestPreferences:
    def test_update_roundtrip(self, client):
        login = client.post("/api/v1/auth/login", data={
            "username": "digest@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = client.patch("/api/v1/auth/me/notification-preferences", headers=headers, json={
            "digest_enabled": True, "digest_hour_utc": 6,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["digest_enabled"] is True
        assert resp.json()["digest_hour_utc"] == 6

        again = client.get("/api/v1/auth/me/notification-preferences", headers=headers)
        assert again.json()["digest_hour_utc"] == 6

    def test_validation(self, client):
        login = client.post("/api/v1/auth/login", data={
            "username": "digest@example.com", "password": "testpass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert client.patch(
            "/api/v1/auth/me/notification-preferences", headers=headers,
            json={"digest_hour_utc": 24},
        ).status_code == 422


class TestDigestTasks:
    @pytest.mark.asyncio
    async def test_task_sections(self, client):
        from backend.models.case import Case, CaseTask
        uid = _user_id()
        with TestingSessionLocal() as session:
            case = Case(user_id=uid, title="Beaconing host", severity="high", status="open")
            session.add(case)
            session.flush()
            session.add(CaseTask(case_id=case.id, title="Late task", position=0,
                                 assignee_id=uid, done=False, due_date=YESTERDAY))
            session.add(CaseTask(case_id=case.id, title="Today task", position=1,
                                 assignee_id=uid, done=False, due_date=TODAY))
            session.add(CaseTask(case_id=case.id, title="Tomorrow task", position=2,
                                 assignee_id=uid, done=False, due_date=TOMORROW))
            session.add(CaseTask(case_id=case.id, title="Done late task", position=3,
                                 assignee_id=uid, done=True, due_date=YESTERDAY))
            session.add(CaseTask(case_id=case.id, title="Undated task", position=4,
                                 assignee_id=uid, done=False))
            session.commit()
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            digest = await build_digest(session, user)
            await session.rollback()
        assert digest["overdue_tasks"] == [
            {"title": "Late task", "case_title": "Beaconing host", "due_date": YESTERDAY.isoformat()}
        ]
        assert digest["tasks_due_today"] == 1
        assert digest["tasks_due_tomorrow"] == 1
        rendered = render_digest(digest)
        assert "Tasks due today: 1" in rendered
        assert "Tasks due tomorrow: 1" in rendered
        assert "Late task (Beaconing host, was due " in rendered
        assert "Done late task" not in rendered

    @pytest.mark.asyncio
    async def test_tasks_alone_make_the_digest_non_empty(self, client):
        from backend.models.case import Case, CaseTask
        uid = _user_id()
        with TestingSessionLocal() as session:
            case = Case(user_id=uid, title="Solo case", severity="low", status="resolved")
            session.add(case)
            session.flush()
            # A task on an active case assigned to the user, due today.
            active = Case(user_id=uid, title="Active case", severity="low", status="open")
            session.add(active)
            session.flush()
            session.add(CaseTask(case_id=active.id, title="Due today", position=0,
                                 assignee_id=uid, done=False, due_date=TODAY))
            session.commit()
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            digest = await build_digest(session, user)
            await session.rollback()
        assert digest["tasks_due_today"] == 1
        assert _is_empty(digest) is False

    @pytest.mark.asyncio
    async def test_tasks_on_closed_cases_are_skipped(self, client):
        from backend.models.case import Case, CaseTask
        uid = _user_id()
        with TestingSessionLocal() as session:
            case = Case(user_id=uid, title="Closed case", severity="low", status="closed")
            session.add(case)
            session.flush()
            session.add(CaseTask(case_id=case.id, title="Stale task", position=0,
                                 assignee_id=uid, done=False, due_date=YESTERDAY))
            session.commit()
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, uid)
            digest = await build_digest(session, user)
            await session.rollback()
        assert digest["overdue_tasks"] == []
        assert digest["tasks_due_today"] == 0
