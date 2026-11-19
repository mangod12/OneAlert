"""Tests for alert watchers: read access, watch management, status notifications."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.organization import Organization
from backend.models.remediation import RemediationAction  # noqa: F401  (registers the table)
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_watchers.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_watchers.db"
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


def _setup(client):
    # Owner plus will@ and sam@ in one org; owner creates an asset and an alert.
    owner = _register_and_login(client, "owner@example.com")
    will = _register_and_login(client, "will@example.com")
    sam = _register_and_login(client, "sam@example.com")
    owner_id = _user_id(client, owner)
    will_id = _user_id(client, will)
    sam_id = _user_id(client, sam)
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme", slug="acme")
        db.add(org)
        db.commit()
        db.refresh(org)
        for uid in (owner_id, will_id, sam_id):
            user = db.get(User, uid)
            user.org_id = org.id
        asset = Asset(user_id=owner_id, name="edge-router-01", asset_type="hardware", vendor="Acme", product="RouterOS")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        alert = Alert(
            user_id=owner_id, asset_id=asset.id, cve_id="CVE-2026-0001",
            title="RouterOS remote code execution", severity="critical",
            status="pending", created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        alert_id = alert.id
    return owner, will, sam, will_id, sam_id, alert_id


def _update_notes(client, headers):
    feed = client.get("/api/v1/notifications/", headers=headers).json()
    return [n for n in feed["data"] if n["kind"] == "alert_updated"]


class TestAlertWatchManagement:
    def test_owner_adds_watcher_and_member_is_notified(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        resp = client.post(
            f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        watchers = resp.json()
        assert [w["user_id"] for w in watchers] == [will_id]

        feed = client.get("/api/v1/notifications/", headers=will).json()
        notes = [n for n in feed["data"] if n["kind"] == "alert_watching"]
        assert len(notes) == 1
        assert notes[0]["title"] == f"You are now watching alert #{alert_id}"
        assert notes[0]["link"] == f"/app/alerts?alert={alert_id}"

    def test_add_watcher_is_idempotent(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        for _ in range(2):
            resp = client.post(
                f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner,
            )
            assert resp.status_code == 200, resp.text
        assert len(resp.json()) == 1
        feed = client.get("/api/v1/notifications/", headers=will).json()
        notes = [n for n in feed["data"] if n["kind"] == "alert_watching"]
        assert len(notes) == 1

    def test_watcher_must_be_org_member(self, client):
        owner, _, _, _, _, alert_id = _setup(client)
        outsider = _register_and_login(client, "outsider@example.com")
        outsider_id = _user_id(client, outsider)
        resp = client.post(
            f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": outsider_id}, headers=owner,
        )
        assert resp.status_code == 400, resp.text

    def test_self_watch_and_unwatch_are_idempotent(self, client):
        owner, _, _, _, _, alert_id = _setup(client)
        for _ in range(2):
            resp = client.post(f"/api/v1/alerts/{alert_id}/watch", headers=owner)
            assert resp.status_code == 200 and resp.json()["watching"] is True
        resp = client.get(f"/api/v1/alerts/{alert_id}/watchers", headers=owner)
        assert len(resp.json()) == 1
        for _ in range(2):
            resp = client.delete(f"/api/v1/alerts/{alert_id}/watch", headers=owner)
            assert resp.status_code == 200 and resp.json()["watching"] is False
        resp = client.get(f"/api/v1/alerts/{alert_id}/watchers", headers=owner)
        assert resp.json() == []

    def test_watcher_cannot_remove_other_watchers(self, client):
        owner, will, _sam, will_id, sam_id, alert_id = _setup(client)
        for uid in (will_id, sam_id):
            client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": uid}, headers=owner)
        resp = client.delete(f"/api/v1/alerts/{alert_id}/watchers/{sam_id}", headers=will)
        assert resp.status_code == 403, resp.text
        resp = client.delete(f"/api/v1/alerts/{alert_id}/watchers/{sam_id}", headers=owner)
        assert resp.status_code == 204, resp.text


class TestAlertWatcherAccess:
    def test_watcher_can_read_alert_and_notes(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        resp = client.get(f"/api/v1/alerts/{alert_id}", headers=will)
        assert resp.status_code == 404
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.get(f"/api/v1/alerts/{alert_id}", headers=will)
        assert resp.status_code == 200, resp.text
        resp = client.post(
            f"/api/v1/alerts/{alert_id}/notes", json={"body": "Watching this"}, headers=will,
        )
        assert resp.status_code in (200, 201), resp.text

    def test_watcher_cannot_change_status(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.post(f"/api/v1/alerts/{alert_id}/acknowledge", headers=will)
        assert resp.status_code == 404, resp.text

    def test_unwatching_removes_read_access(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.get(f"/api/v1/alerts/{alert_id}", headers=will)
        assert resp.status_code == 200
        resp = client.delete(f"/api/v1/alerts/{alert_id}/watchers/{will_id}", headers=owner)
        assert resp.status_code == 204
        resp = client.get(f"/api/v1/alerts/{alert_id}", headers=will)
        assert resp.status_code == 404


class TestAlertWatcherNotifications:
    def test_acknowledge_notifies_watchers_not_actor(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        client.post(f"/api/v1/alerts/{alert_id}/watch", headers=owner)
        resp = client.post(f"/api/v1/alerts/{alert_id}/acknowledge", headers=owner)
        assert resp.status_code == 200, resp.text

        notes = _update_notes(client, will)
        assert len(notes) == 1
        assert notes[0]["title"] == f"Alert #{alert_id} updated"
        assert "status pending -> acknowledged" in notes[0]["body"]
        assert notes[0]["link"] == f"/app/alerts?alert={alert_id}"
        # The owner acted and gets no self-notification.
        assert _update_notes(client, owner) == []

    def test_resolve_and_reopen_notify_watchers(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=owner)
        client.post(f"/api/v1/alerts/{alert_id}/reopen", headers=owner)

        notes = _update_notes(client, will)
        assert len(notes) == 2
        assert "status pending -> resolved" in notes[1]["body"]
        assert "status resolved -> pending" in notes[0]["body"]

    def test_assignee_transition_notifies_watcher(self, client):
        owner, will, sam, will_id, sam_id, alert_id = _setup(client)
        # will is the assignee; sam watches.
        client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": will_id}, headers=owner)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": sam_id}, headers=owner)
        resp = client.post(f"/api/v1/alerts/{alert_id}/acknowledge", headers=will)
        assert resp.status_code == 200, resp.text

        notes = _update_notes(client, sam)
        assert len(notes) == 1
        assert "status pending -> acknowledged" in notes[0]["body"]
        # The assignee acted and gets no self-notification.
        assert _update_notes(client, will) == []

    def test_snooze_does_not_notify_watchers(self, client):
        owner, will, _, will_id, _, alert_id = _setup(client)
        client.post(f"/api/v1/alerts/{alert_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.post(
            f"/api/v1/alerts/{alert_id}/snooze", json={"hours": 24}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        assert _update_notes(client, will) == []
