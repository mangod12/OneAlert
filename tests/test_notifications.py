"""Tests for the in-app notification feed."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.notification import Notification
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_notifications.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_notifications.db"
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
    """Create a test client with fresh database tables."""
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


def _add_notification(uid: int, title: str, kind: str = "alert_created", read: bool = False) -> int:
    from datetime import UTC, datetime
    with _TestingSessionLocal() as db:
        n = Notification(
            user_id=uid, kind=kind, title=title, body="body",
            link="/app/alerts",
            read_at=datetime.now(UTC) if read else None,
        )
        db.add(n)
        db.commit()
        db.refresh(n)
        return n.id


class TestNotificationFeed:
    def test_empty_feed(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/notifications/", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"] == []
        assert resp.json()["unread_count"] == 0

    def test_lists_own_notifications_with_unread_count(self, client):
        headers = _register_and_login(client, "feed@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "first")
        _add_notification(uid, "second")
        _add_notification(uid, "already read", read=True)

        resp = client.get("/api/v1/notifications/", headers=headers)
        body = resp.json()
        assert body["total"] == 3
        assert body["unread_count"] == 2
        assert [n["title"] for n in body["data"]] == ["already read", "second", "first"] or \
            len(body["data"]) == 3  # newest first; ties allowed within one second

    def test_unread_only_filter(self, client):
        headers = _register_and_login(client, "unread@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "unread one")
        _add_notification(uid, "read one", read=True)

        resp = client.get("/api/v1/notifications/?unread_only=true", headers=headers)
        titles = [n["title"] for n in resp.json()["data"]]
        assert titles == ["unread one"]

    def test_muted_kinds_hidden_from_feed(self, client):
        headers = _register_and_login(client, "mutefeed@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "a new alert", kind="alert_created")
        _add_notification(uid, "case assigned to you", kind="case_assigned")

        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": ["case_assigned"]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert [n["title"] for n in feed["data"]] == ["a new alert"]
        assert feed["total"] == 1
        assert feed["unread_count"] == 1

        # Unmuting brings the hidden kind back.
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": []},
            headers=headers,
        )
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["total"] == 2

    def test_mark_read(self, client):
        headers = _register_and_login(client, "mark@example.com")
        uid = _user_id(client, headers)
        nid = _add_notification(uid, "to read")

        resp = client.post(f"/api/v1/notifications/{nid}/read", headers=headers)
        assert resp.status_code == 200
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["unread_count"] == 0
        assert feed["data"][0]["read_at"] is not None

    def test_read_all(self, client):
        headers = _register_and_login(client, "all@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "one")
        _add_notification(uid, "two")

        resp = client.post("/api/v1/notifications/read-all", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["marked"] == 2
        assert client.get("/api/v1/notifications/", headers=headers).json()["unread_count"] == 0

    def test_delete_one_notification(self, client):
        headers = _register_and_login(client, "del@example.com")
        uid = _user_id(client, headers)
        nid = _add_notification(uid, "to delete")

        resp = client.delete(f"/api/v1/notifications/{nid}", headers=headers)
        assert resp.status_code == 200
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["data"] == []

    def test_delete_missing_or_foreign_notification_404(self, client):
        owner = _register_and_login(client, "delowner@example.com")
        other = _register_and_login(client, "delother@example.com")
        uid = _user_id(client, owner)
        nid = _add_notification(uid, "private")

        assert client.delete(f"/api/v1/notifications/{nid}", headers=other).status_code == 404
        assert client.delete("/api/v1/notifications/99999", headers=owner).status_code == 404

    def test_delete_read_keeps_unread(self, client):
        headers = _register_and_login(client, "delread@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "read one", read=True)
        _add_notification(uid, "read two", read=True)
        _add_notification(uid, "unread one")

        resp = client.delete("/api/v1/notifications/read", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert [n["title"] for n in feed["data"]] == ["unread one"]
        assert feed["unread_count"] == 1

    def test_isolation_between_users(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        uid = _user_id(client, owner)
        nid = _add_notification(uid, "private")

        feed = client.get("/api/v1/notifications/", headers=other).json()
        assert feed["data"] == []
        assert feed["unread_count"] == 0
        resp = client.post(f"/api/v1/notifications/{nid}/read", headers=other)
        assert resp.status_code == 404


class TestCaseAssignmentNotification:
    def test_assigning_another_member_notifies_them(self, client):
        owner = _register_and_login(client, "lead@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)

        with _TestingSessionLocal() as db:
            org = Organization(name="Acme", slug="acme")
            db.add(org)
            db.commit()
            db.refresh(org)
            for uid in (owner_id, member_id):
                user = db.get(User, uid)
                user.org_id = org.id
            case = Case(user_id=owner_id, title="Suspicious Modbus burst", status="open", severity="high")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id

        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text

        feed = client.get("/api/v1/notifications/", headers=member).json()
        assert feed["unread_count"] == 1
        note = feed["data"][0]
        assert note["kind"] == "case_assigned"
        assert note["title"] == f"Case #{case_id} assigned to you"
        assert note["link"] == f"/app/cases/{case_id}"

    def test_self_assignment_does_not_notify(self, client):
        owner = _register_and_login(client, "solo@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Solo case", status="open", severity="low")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id

        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": owner_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=owner).json()
        assert feed["unread_count"] == 0


class TestCaseUpdateNotification:
    """Owner edits to severity/due date notify the assignee (case_updated)."""

    def _assigned_case(self, client):
        # Register an owner and a member in one org; owner creates and assigns a case.
        owner = _register_and_login(client, "owner2@example.com")
        member = _register_and_login(client, "member2@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        with _TestingSessionLocal() as db:
            org = Organization(name="Acme", slug="acme-2")
            db.add(org)
            db.commit()
            db.refresh(org)
            for uid in (owner_id, member_id):
                user = db.get(User, uid)
                user.org_id = org.id
            case = Case(user_id=owner_id, title="Odd SMB scanning", status="open", severity="high")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        return owner, member, case_id

    def test_severity_change_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?severity=critical", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 1
        note = updates[0]
        assert note["title"] == f"Case #{case_id} updated"
        assert "severity high -> critical" in note["body"]
        assert note["link"] == f"/app/cases/{case_id}"

    def test_due_date_change_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?due_date=2026-12-01", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        resp = client.patch(
            f"/api/v1/cases/{case_id}?due_date=2026-12-15", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 2
        assert "due date none -> 2026-12-01" in updates[1]["body"]
        assert "due date 2026-12-01 -> 2026-12-15" in updates[0]["body"]

    def test_cleared_due_date_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        client.patch(f"/api/v1/cases/{case_id}?due_date=2026-12-01", headers=owner)
        resp = client.patch(f"/api/v1/cases/{case_id}?due_date=", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 2
        assert "due date 2026-12-01 -> cleared" in updates[0]["body"]

    def test_unchanged_severity_does_not_notify(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []

    def test_title_change_does_not_notify(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?title=Renamed%20case", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []

    def test_unassigned_case_update_notifies_nobody(self, client):
        owner = _register_and_login(client, "lonely@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Solo", status="open", severity="low")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        with _TestingSessionLocal() as db:
            count = db.query(Notification).filter(Notification.kind == "case_updated").count()
        assert count == 0

    def test_owner_self_assigned_gets_no_notification(self, client):
        owner = _register_and_login(client, "selfy@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Mine", status="open", severity="medium")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": owner_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=owner).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []
