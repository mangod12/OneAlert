"""
Tests for shared alerts: assignees can open and work alerts assigned to them.

An alert assigned to an org member becomes visible to them (detail, cases,
remediations, EPSS), they can acknowledge/resolve/reopen/snooze it and add
notes, while assignment and detail edits stay with the owner. Other org
members and outsiders still get 404.
"""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_sharing.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_sharing.db"
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


@pytest.fixture(scope="function")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=_engine)


def _register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    reg = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": password,
        "full_name": f"User {email.split('@')[0]}",
        "company": "TestCorp",
    })
    assert reg.status_code == 201, f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _seed_alert(user_id: int) -> int:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="edge-router-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user_id, asset_id=asset.id, cve_id="CVE-2026-0001",
            title="RouterOS remote code execution", severity="critical",
            status="pending", created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        db.add(alert)
        db.commit()
        return alert.id


def _share_org(*user_ids: int) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


@pytest.fixture
def assigned_alert(client):
    """An org with owner + member, and an alert assigned to the member."""
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    alert_id = _seed_alert(owner_id)
    resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": member_id}, headers=owner)
    assert resp.status_code == 200, resp.text
    return {"owner": owner, "member": member, "owner_id": owner_id, "member_id": member_id, "alert_id": alert_id}


class TestAssigneeVisibility:
    def test_assignee_can_open_assigned_alert(self, client, assigned_alert):
        resp = client.get(f"/api/v1/alerts/{assigned_alert['alert_id']}", headers=assigned_alert["member"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "RouterOS remote code execution"

    def test_assigned_me_lists_alerts_assigned_by_others(self, client, assigned_alert):
        resp = client.get("/api/v1/alerts/?assigned=me", headers=assigned_alert["member"])
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["alerts"]]
        assert assigned_alert["alert_id"] in ids
        # The member's default list stays empty: they own no alerts.
        own = client.get("/api/v1/alerts/", headers=assigned_alert["member"])
        assert own.json()["alerts"] == []

    def test_assignee_can_read_cases_remediations_epss(self, client, assigned_alert):
        aid = assigned_alert["alert_id"]
        for suffix in ("cases", "remediations", "epss"):
            resp = client.get(f"/api/v1/alerts/{aid}/{suffix}", headers=assigned_alert["member"])
            assert resp.status_code == 200, f"{suffix}: {resp.text}"

    def test_unassign_revokes_access(self, client, assigned_alert):
        client.patch(
            f"/api/v1/alerts/{assigned_alert['alert_id']}",
            json={"assigned_to_id": None},
            headers=assigned_alert["owner"],
        )
        resp = client.get(f"/api/v1/alerts/{assigned_alert['alert_id']}", headers=assigned_alert["member"])
        assert resp.status_code == 404


class TestAssigneeActions:
    def test_assignee_can_acknowledge_resolve_reopen(self, client, assigned_alert):
        aid = assigned_alert["alert_id"]
        member = assigned_alert["member"]
        resp = client.post(f"/api/v1/alerts/{aid}/acknowledge", headers=member)
        assert resp.status_code == 200, resp.text
        resp = client.post(f"/api/v1/alerts/{aid}/resolve", headers=member)
        assert resp.status_code == 200, resp.text
        resp = client.post(f"/api/v1/alerts/{aid}/reopen", headers=member)
        assert resp.status_code == 200, resp.text

    def test_assignee_can_snooze_and_unsnooze(self, client, assigned_alert):
        aid = assigned_alert["alert_id"]
        member = assigned_alert["member"]
        resp = client.post(f"/api/v1/alerts/{aid}/snooze", json={"hours": 4}, headers=member)
        assert resp.status_code == 200, resp.text
        resp = client.delete(f"/api/v1/alerts/{aid}/snooze", headers=member)
        assert resp.status_code == 200, resp.text

    def test_assignee_can_read_and_add_notes(self, client, assigned_alert):
        aid = assigned_alert["alert_id"]
        member = assigned_alert["member"]
        resp = client.post(f"/api/v1/alerts/{aid}/notes", json={"body": "Vendor advisory reviewed."}, headers=member)
        assert resp.status_code == 201, resp.text
        listing = client.get(f"/api/v1/alerts/{aid}/notes", headers=member)
        assert any("Vendor advisory reviewed." in n["body"] for n in listing.json())

    def test_assignee_cannot_patch_or_reassign(self, client, assigned_alert):
        aid = assigned_alert["alert_id"]
        resp = client.patch(
            f"/api/v1/alerts/{aid}",
            json={"assigned_to_id": assigned_alert["owner_id"]},
            headers=assigned_alert["member"],
        )
        assert resp.status_code == 404


class TestNonAssigneeAccess:
    def test_other_org_member_gets_404(self, client, assigned_alert):
        third = _register_and_login(client, "third@example.com")
        third_id = _user_id(client, third)
        with _TestingSessionLocal() as db:  # same org, but not the assignee
            db.get(User, third_id).org_id = db.get(User, assigned_alert["owner_id"]).org_id
            db.commit()
        aid = assigned_alert["alert_id"]
        assert client.get(f"/api/v1/alerts/{aid}", headers=third).status_code == 404
        assert client.post(f"/api/v1/alerts/{aid}/acknowledge", headers=third).status_code == 404
        assert client.post(f"/api/v1/alerts/{aid}/notes", json={"body": "hi"}, headers=third).status_code == 404

    def test_outsider_gets_404(self, client, assigned_alert):
        outsider = _register_and_login(client, "outsider@example.com")
        assert client.get(f"/api/v1/alerts/{assigned_alert['alert_id']}", headers=outsider).status_code == 404
