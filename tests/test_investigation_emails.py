"""
Tests for investigation-event emails.

Case assignments, incident auto-escalations and SLA breaches email the
affected user, honoring email preferences: disabled email, muted kinds
and quiet hours (below critical) all suppress the email while the in-app
notification still lands.
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
from backend.models.organization import Organization
from backend.models.user import User
from backend.services.alert_checker import _maybe_auto_escalate
from backend.services.auth_service import get_password_hash
from backend.services.email_alert import email_service
from backend.services.sla import notify_breached_slas

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_investigation_emails.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_investigation_emails.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)

TODAY = datetime.now(UTC).date()
YESTERDAY = TODAY - timedelta(days=1)


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
            email="eventmail@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Event Tester",
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


def _user_id(email: str = "eventmail@example.com") -> int:
    with TestingSessionLocal() as session:
        return session.execute(
            select(User.id).where(User.email == email)
        ).scalar_one()


def _set_prefs(user_id: int, **fields) -> None:
    with TestingSessionLocal() as session:
        user = session.get(User, user_id)
        for field, value in fields.items():
            setattr(user, field, value)
        session.commit()


class TestSlaBreachEmail:
    @pytest.mark.asyncio
    async def test_breach_emails_owner(self, client):
        uid = _user_id()
        with TestingSessionLocal() as session:
            session.add(Case(
                user_id=uid, title="Ransomware on historian", severity="critical",
                status="open", due_date=YESTERDAY,
            ))
            session.commit()
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await notify_breached_slas(session) == 1
                await session.rollback()
        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["title"] == "Investigation overdue: Ransomware on historian"
        assert kwargs["link_path"].startswith("/app/cases/")

    @pytest.mark.asyncio
    async def test_breach_email_suppressed_when_email_disabled(self, client):
        uid = _user_id()
        _set_prefs(uid, email_notifications_enabled=False)
        with TestingSessionLocal() as session:
            session.add(Case(
                user_id=uid, title="Overdue", severity="critical",
                status="open", due_date=YESTERDAY,
            ))
            session.commit()
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await notify_breached_slas(session) == 1  # in-app still lands
                await session.rollback()
        send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_breach_email_suppressed_when_kind_muted(self, client):
        uid = _user_id()
        _set_prefs(uid, muted_kinds=["case_sla_breached"])
        with TestingSessionLocal() as session:
            session.add(Case(
                user_id=uid, title="Overdue", severity="critical",
                status="open", due_date=YESTERDAY,
            ))
            session.commit()
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                assert await notify_breached_slas(session) == 1
                await session.rollback()
        send.assert_not_awaited()


class TestAutoEscalationEmail:
    @pytest.mark.asyncio
    async def test_escalation_emails_user(self, client):
        uid = _user_id()
        _set_prefs(uid, auto_escalate_incidents=True)
        with TestingSessionLocal() as session:
            asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
            session.add(asset)
            session.flush()
            asset_id = asset.id
            for title, severity in [("a1", "critical"), ("a2", "high"), ("a3", "high")]:
                session.add(Alert(
                    user_id=uid, asset_id=asset_id, title=title,
                    description="t", severity=severity, status="pending",
                ))
            session.commit()
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            async with AsyncTestingSessionLocal() as session:
                user = await session.get(User, uid)
                asset = await session.get(Asset, asset_id)
                await _maybe_auto_escalate(session, user, asset)
                await session.rollback()
        send.assert_awaited_once()
        assert "auto-escalated" in send.await_args.kwargs["title"]


def _register_and_login(client: TestClient, email: str):
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": "securepass123",
        "full_name": f"User {email.split('@')[0]}", "company": "TestCorp",
    })
    assert reg.status_code == 201, reg.text
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "securepass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


class TestAssignmentEmail:
    def test_assignment_emails_assignee(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = client.get("/api/v1/auth/me", headers=owner).json()["id"]
        member_id = client.get("/api/v1/auth/me", headers=member).json()["id"]
        with TestingSessionLocal() as session:
            org = Organization(name="Acme SOC", slug="acme-soc", plan="pro",
                               max_assets=100, max_users=10)
            session.add(org)
            session.flush()
            session.get(User, owner_id).org_id = org.id
            session.get(User, member_id).org_id = org.id
            session.commit()
        case = client.post("/api/v1/cases/", json={"title": "Odd VPN logins", "severity": "high"},
                           headers=owner)
        assert case.status_code == 201, case.text
        case_id = case.json()["id"]

        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            resp = client.post(f"/api/v1/cases/{case_id}/assign",
                               json={"user_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["title"] == f"Case #{case_id} assigned to you"
        assert "owner@example.com" in kwargs["body"]
        assert kwargs["link_path"] == f"/app/cases/{case_id}"

    def test_no_email_for_self_assignment(self, client):
        owner = _register_and_login(client, "solo@example.com")
        owner_id = client.get("/api/v1/auth/me", headers=owner).json()["id"]
        case = client.post("/api/v1/cases/", json={"title": "Solo case", "severity": "low"},
                           headers=owner)
        case_id = case.json()["id"]
        with patch.object(
            email_service, "send_investigation_event", new=AsyncMock(return_value=True)
        ) as send:
            resp = client.post(f"/api/v1/cases/{case_id}/assign",
                               json={"user_id": owner_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        send.assert_not_awaited()


class TestMutedKindsRegistration:
    def test_new_kinds_can_be_muted(self, client):
        headers = _register_and_login(client, "mute@example.com")
        resp = client.patch("/api/v1/auth/me/notification-preferences", headers=headers, json={
            "muted_kinds": ["incident_escalated", "case_sla_breached"],
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["muted_kinds"] == ["incident_escalated", "case_sla_breached"]

    def test_unknown_kind_still_rejected(self, client):
        headers = _register_and_login(client, "mute2@example.com")
        resp = client.patch("/api/v1/auth/me/notification-preferences", headers=headers, json={
            "muted_kinds": ["not_a_kind"],
        })
        assert resp.status_code == 422
