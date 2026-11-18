"""
Tests for shared investigations: assignees can open and work their cases.

A case assigned to an org member becomes visible to them (detail, export,
linked alerts/events), they can add notes and move the status, while case
details, deletion and linking stay with the owner. Other org members and
outsiders still get 404.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_sharing.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_sharing.db"
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


def _create_case(client: TestClient, headers) -> int:
    resp = client.post("/api/v1/cases/", json={"title": "Suspicious login burst", "severity": "high"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _share_org(*user_ids: int) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


@pytest.fixture
def assigned_case(client):
    """An org with owner + member, and a case assigned to the member."""
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _create_case(client, owner)
    resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner)
    assert resp.status_code == 200, resp.text
    return {"owner": owner, "member": member, "owner_id": owner_id, "member_id": member_id, "case_id": case_id}


class TestAssigneeVisibility:
    def test_assignee_can_open_assigned_case(self, client, assigned_case):
        resp = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["member"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Suspicious login burst"
        assert resp.json()["assigned_to_email"] == "member@example.com"

    def test_assigned_me_lists_cases_assigned_by_others(self, client, assigned_case):
        resp = client.get("/api/v1/cases/?assigned=me", headers=assigned_case["member"])
        assert resp.status_code == 200, resp.text
        ids = [c["id"] for c in resp.json()["cases"]]
        assert assigned_case["case_id"] in ids
        # The member's own (unfiltered) list stays empty: they own nothing.
        own = client.get("/api/v1/cases/", headers=assigned_case["member"])
        assert own.json()["cases"] == []

    def test_assignee_can_export_timeline(self, client, assigned_case):
        resp = client.get(f"/api/v1/cases/{assigned_case['case_id']}/export", headers=assigned_case["member"])
        assert resp.status_code == 200, resp.text

    def test_assignee_can_list_case_alerts_and_events(self, client, assigned_case):
        alerts = client.get(f"/api/v1/cases/{assigned_case['case_id']}/alerts", headers=assigned_case["member"])
        assert alerts.status_code == 200, alerts.text
        events = client.get(f"/api/v1/cases/{assigned_case['case_id']}/events", headers=assigned_case["member"])
        assert events.status_code == 200, events.text

    def test_unassign_revokes_access(self, client, assigned_case):
        client.post(
            f"/api/v1/cases/{assigned_case['case_id']}/assign", json={"user_id": None}, headers=assigned_case["owner"]
        )
        resp = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["member"])
        assert resp.status_code == 404


class TestAssigneeWrites:
    def test_assignee_can_add_note(self, client, assigned_case):
        resp = client.post(
            f"/api/v1/cases/{assigned_case['case_id']}/notes",
            json={"content": "Containment started on the edge router."},
            headers=assigned_case["member"],
        )
        assert resp.status_code == 201, resp.text
        detail = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["member"])
        notes = [e for e in detail.json()["timeline"] if e["entry_type"] == "note"]
        assert any("Containment started" in e["content"] for e in notes)

    def test_assignee_can_update_status(self, client, assigned_case):
        resp = client.patch(
            f"/api/v1/cases/{assigned_case['case_id']}?status_update=investigating",
            headers=assigned_case["member"],
        )
        assert resp.status_code == 200, resp.text
        detail = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["owner"])
        assert detail.json()["status"] == "investigating"

    def test_assignee_cannot_edit_case_details(self, client, assigned_case):
        for params in ("title=Renamed", "severity=low", "summary=x", "due_date=2026-12-01"):
            resp = client.patch(
                f"/api/v1/cases/{assigned_case['case_id']}?{params}",
                headers=assigned_case["member"],
            )
            assert resp.status_code == 403, f"{params}: {resp.text}"
        detail = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["owner"])
        assert detail.json()["title"] == "Suspicious login burst"
        assert detail.json()["severity"] == "high"

    def test_assignee_cannot_delete_or_reassign(self, client, assigned_case):
        resp = client.delete(f"/api/v1/cases/{assigned_case['case_id']}", headers=assigned_case["member"])
        assert resp.status_code == 404
        resp = client.post(
            f"/api/v1/cases/{assigned_case['case_id']}/assign",
            json={"user_id": assigned_case["owner_id"]},
            headers=assigned_case["member"],
        )
        assert resp.status_code == 404


class TestNonAssigneeAccess:
    def test_other_org_member_gets_404(self, client, assigned_case):
        third = _register_and_login(client, "third@example.com")
        third_id = _user_id(client, third)
        with _TestingSessionLocal() as db:  # third joins the same org, but is not the assignee
            db.get(User, third_id).org_id = db.get(User, assigned_case["owner_id"]).org_id
            db.commit()
        resp = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=third)
        assert resp.status_code == 404
        resp = client.patch(
            f"/api/v1/cases/{assigned_case['case_id']}?status_update=resolved", headers=third
        )
        assert resp.status_code == 404
        resp = client.post(
            f"/api/v1/cases/{assigned_case['case_id']}/notes", json={"content": "hi"}, headers=third
        )
        assert resp.status_code == 404

    def test_outsider_gets_404(self, client, assigned_case):
        outsider = _register_and_login(client, "outsider@example.com")
        resp = client.get(f"/api/v1/cases/{assigned_case['case_id']}", headers=outsider)
        assert resp.status_code == 404
