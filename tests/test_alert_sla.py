"""Tests for alert triage due dates: PATCH set/clear, overdue filter, SLA notifications."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.notification import Notification
from backend.services.sla import notify_breached_alert_slas, notify_due_soon_alert_slas

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_sla.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_sla.db"
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


@pytest.fixture
def client():
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


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _seed_alert(user_id: int, title: str, due: date | None = None, alert_status: str = "pending") -> int:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name=f"asset-{title[:8]}", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user_id, asset_id=asset.id, title=title, severity="high",
            status=alert_status, due_date=due,
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


TODAY = datetime.now(UTC).date()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)


def test_set_and_clear_due_date(client):
    headers = _register_and_login(client, "sla@example.com")
    uid = _user_id(client, headers)
    alert_id = _seed_alert(uid, "Overdue candidate")

    set_resp = client.patch(
        f"/api/v1/alerts/{alert_id}", json={"due_date": TOMORROW.isoformat()}, headers=headers
    )
    assert set_resp.status_code == 200, set_resp.text
    assert set_resp.json()["due_date"] == TOMORROW.isoformat()

    cleared = client.patch(f"/api/v1/alerts/{alert_id}", json={"due_date": None}, headers=headers)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["due_date"] is None


def test_overdue_filter(client):
    headers = _register_and_login(client, "overdue@example.com")
    uid = _user_id(client, headers)
    overdue_id = _seed_alert(uid, "Past triage target", due=YESTERDAY)
    _seed_alert(uid, "Due tomorrow", due=TOMORROW)
    _seed_alert(uid, "Resolved and late", due=YESTERDAY, alert_status="resolved")
    _seed_alert(uid, "No target")

    resp = client.get("/api/v1/alerts/?overdue=true", headers=headers)
    assert resp.status_code == 200, resp.text
    ids = [a["id"] for a in resp.json()["alerts"]]
    assert ids == [overdue_id]
    assert resp.json()["alerts"][0]["due_date"] == YESTERDAY.isoformat()


def test_overdue_filter_omitted_keeps_everything(client):
    headers = _register_and_login(client, "all@example.com")
    uid = _user_id(client, headers)
    _seed_alert(uid, "Past triage target", due=YESTERDAY)
    resp = client.get("/api/v1/alerts/", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_breach_notifies_owner_once(client):
    headers = _register_and_login(client, "breach@example.com")
    uid = _user_id(client, headers)
    alert_id = _seed_alert(uid, "Late critical patch", due=YESTERDAY)

    async with _AsyncTestingSessionLocal() as session:
        sent = await notify_breached_alert_slas(session)
        assert sent == 1
        notification = (await session.execute(
            select(Notification).where(
                Notification.user_id == uid, Notification.kind == "alert_sla_breached"
            )
        )).scalar_one()
        assert "Late critical patch" in notification.title
        assert notification.link == f"/app/alerts?alert={alert_id}"
        assert "1 day ago" in notification.body

        # Second run does not re-notify.
        again = await notify_breached_alert_slas(session)
        assert again == 0


@pytest.mark.asyncio
async def test_breach_skips_resolved_and_future(client):
    headers = _register_and_login(client, "skip@example.com")
    uid = _user_id(client, headers)
    _seed_alert(uid, "Resolved late", due=YESTERDAY, alert_status="resolved")
    _seed_alert(uid, "Future target", due=TOMORROW)
    _seed_alert(uid, "No target")

    async with _AsyncTestingSessionLocal() as session:
        assert await notify_breached_alert_slas(session) == 0


@pytest.mark.asyncio
async def test_breach_notifies_assignee_too(client):
    headers = _register_and_login(client, "owner@example.com")
    uid = _user_id(client, headers)
    alert_id = _seed_alert(uid, "Assigned and late", due=YESTERDAY)
    with _TestingSessionLocal() as db:
        db.get(Alert, alert_id).assigned_to_id = uid + 100  # second recipient id
        # create the assignee user so the notification targets a real account
        from backend.models.user import User
        from backend.services.auth_service import get_password_hash
        db.add(User(
            id=uid + 100, email="assignee@example.com",
            hashed_password=get_password_hash("securepass123"),
            full_name="Assignee", is_active=True, is_verified=True,
        ))
        db.commit()

    async with _AsyncTestingSessionLocal() as session:
        assert await notify_breached_alert_slas(session) == 1
        rows = (await session.execute(
            select(Notification).where(Notification.kind == "alert_sla_breached")
        )).scalars().all()
        assert {n.user_id for n in rows} == {uid, uid + 100}


@pytest.mark.asyncio
async def test_due_soon_warns_the_day_before(client):
    headers = _register_and_login(client, "duesoon@example.com")
    uid = _user_id(client, headers)
    _seed_alert(uid, "Due tomorrow", due=TOMORROW)

    async with _AsyncTestingSessionLocal() as session:
        warned = await notify_due_soon_alert_slas(session)
        assert warned == 1
        notification = (await session.execute(
            select(Notification).where(
                Notification.user_id == uid, Notification.kind == "alert_sla_due_soon"
            )
        )).scalar_one()
        assert "Due tomorrow" in notification.title
        assert await notify_due_soon_alert_slas(session) == 0


@pytest.mark.asyncio
async def test_moving_due_date_rearms_notifications(client):
    headers = _register_and_login(client, "rearm@example.com")
    uid = _user_id(client, headers)
    alert_id = _seed_alert(uid, "Re-armed", due=YESTERDAY)

    async with _AsyncTestingSessionLocal() as session:
        assert await notify_breached_alert_slas(session) == 1

    # Move the target forward; markers reset.
    moved = client.patch(
        f"/api/v1/alerts/{alert_id}", json={"due_date": TOMORROW.isoformat()}, headers=headers
    )
    assert moved.status_code == 200, moved.text

    async with _AsyncTestingSessionLocal() as session:
        # No longer breached; the due-soon warning fires fresh for the new date.
        assert await notify_breached_alert_slas(session) == 0
        assert await notify_due_soon_alert_slas(session) == 1
