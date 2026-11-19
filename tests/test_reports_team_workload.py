"""Tests for GET /api/v1/reports/team-workload."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseTask
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reports_team_workload.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_reports_team_workload.db"
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


TODAY = datetime.now(UTC).date()


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
    login = client.post("/api/v1/auth/login", data={
        "username": email,
        "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _share_org(*user_ids: int) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


def _naive(days_ago=0):
    return (datetime.now(UTC) - timedelta(days=days_ago)).replace(tzinfo=None)


def _seed(owner_id: int, member_id: int) -> None:
    """Owner has 2 open alerts (1 overdue) + a case task; member has an open
    case (overdue) + a done alert that must not be counted."""
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=owner_id, name="edge-router", asset_type="hardware")
        db.add(asset)
        db.flush()

        db.add(Alert(
            user_id=owner_id, asset_id=asset.id, title="Overdue triage",
            severity="high", status="pending", created_at=_naive(days_ago=5),
            due_date=TODAY - timedelta(days=2), assigned_to_id=owner_id,
        ))
        db.add(Alert(
            user_id=owner_id, asset_id=asset.id, title="Fresh alert",
            severity="medium", status="acknowledged", created_at=_naive(days_ago=1),
            due_date=TODAY + timedelta(days=3), assigned_to_id=owner_id,
        ))
        db.add(Alert(
            user_id=owner_id, asset_id=asset.id, title="Resolved alert",
            severity="low", status="resolved", created_at=_naive(days_ago=9),
            due_date=TODAY - timedelta(days=5), assigned_to_id=member_id,
        ))

        case = Case(
            user_id=owner_id, title="Open investigation", severity="medium",
            status="investigating", created_at=_naive(days_ago=6),
            due_date=TODAY - timedelta(days=1), assigned_to_id=member_id,
        )
        db.add(case)
        db.flush()
        db.add(CaseTask(
            case_id=case.id, title="Contain host", done=False,
            assignee_id=owner_id, position=0,
        ))
        db.add(CaseTask(
            case_id=case.id, title="Write report", done=True,
            assignee_id=member_id, position=1,
        ))
        db.add(Case(
            user_id=owner_id, title="Closed investigation", severity="low",
            status="closed", created_at=_naive(days_ago=10),
            due_date=TODAY - timedelta(days=6), assigned_to_id=member_id,
        ))
        db.commit()


def test_team_workload_counts_per_member(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    _seed(owner_id, member_id)

    resp = client.get("/api/v1/reports/team-workload", headers=owner)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    rows = {r["email"]: r for r in body["members"]}
    assert set(rows) == {"owner@example.com", "member@example.com"}

    o = rows["owner@example.com"]
    assert o["alerts_open"] == 2
    assert o["alerts_overdue"] == 1
    assert o["cases_open"] == 0
    assert o["cases_overdue"] == 0
    assert o["tasks_open"] == 1

    m = rows["member@example.com"]
    assert m["alerts_open"] == 0  # resolved alert not counted
    assert m["cases_open"] == 1  # closed case not counted
    assert m["cases_overdue"] == 1
    assert m["tasks_open"] == 0  # done task not counted


def test_team_workload_sorted_by_open_work(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    _seed(owner_id, member_id)

    resp = client.get("/api/v1/reports/team-workload", headers=member)
    assert resp.status_code == 200, resp.text
    emails = [r["email"] for r in resp.json()["members"]]
    # Owner has 3 open items vs member's 1.
    assert emails[0] == "owner@example.com"


def test_team_workload_solo_user_sees_self(client):
    solo = _register_and_login(client, "solo@example.com")
    solo_id = _user_id(client, solo)
    _seed(solo_id, solo_id)

    resp = client.get("/api/v1/reports/team-workload", headers=solo)
    assert resp.status_code == 200, resp.text
    rows = resp.json()["members"]
    assert len(rows) == 1
    assert rows[0]["email"] == "solo@example.com"
    assert rows[0]["alerts_open"] == 2
    assert rows[0]["tasks_open"] == 1


def test_team_workload_excludes_inactive_members(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    with _TestingSessionLocal() as db:
        db.get(User, member_id).is_active = False
        db.commit()

    resp = client.get("/api/v1/reports/team-workload", headers=owner)
    assert resp.status_code == 200, resp.text
    emails = [r["email"] for r in resp.json()["members"]]
    assert emails == ["owner@example.com"]


def test_team_workload_requires_auth(client):
    resp = client.get("/api/v1/reports/team-workload")
    assert resp.status_code == 401
