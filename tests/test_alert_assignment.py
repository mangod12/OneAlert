"""Tests for assigning alerts to organization members via PATCH /api/v1/alerts/{id}."""

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
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_assignment.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_assignment.db"
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
    """Create a test client with fresh database tables."""
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
    """Put the given users into one organization."""
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


class TestAlertAssignment:
    def test_assign_to_org_member(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        alert_id = _seed_alert(owner_id)

        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text

        listing = client.get("/api/v1/alerts/", headers=owner)
        assert listing.status_code == 200
        row = listing.json()["alerts"][0]
        assert row["assigned_to_id"] == member_id
        assert row["assigned_to_email"] == "member@example.com"

    def test_unassign_with_explicit_null(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        alert_id = _seed_alert(owner_id)

        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": None}, headers=owner)
        assert resp.status_code == 200, resp.text
        listing = client.get("/api/v1/alerts/", headers=owner)
        assert listing.json()["alerts"][0]["assigned_to_id"] is None

    def test_assign_to_unknown_user_returns_400(self, client):
        owner = _register_and_login(client, "owner@example.com")
        owner_id = _user_id(client, owner)
        alert_id = _seed_alert(owner_id)

        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": 99999}, headers=owner)
        assert resp.status_code == 400, resp.text

    def test_assign_to_user_outside_org_returns_400(self, client):
        owner = _register_and_login(client, "owner@example.com")
        outsider = _register_and_login(client, "outsider@example.com")
        owner_id = _user_id(client, owner)
        outsider_id = _user_id(client, outsider)
        _share_org(owner_id)  # outsider stays org-less
        alert_id = _seed_alert(owner_id)

        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": outsider_id}, headers=owner)
        assert resp.status_code == 400, resp.text

    def test_status_updates_still_work(self, client):
        owner = _register_and_login(client, "owner@example.com")
        owner_id = _user_id(client, owner)
        alert_id = _seed_alert(owner_id)

        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"status": "acknowledged"}, headers=owner)
        assert resp.status_code == 200, resp.text
        listing = client.get("/api/v1/alerts/", headers=owner)
        assert listing.json()["alerts"][0]["status"] == "acknowledged"


class TestAlertAssignmentFilter:
    def _setup(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        alert_id = _seed_alert(owner_id)
        resp = client.patch(f"/api/v1/alerts/{alert_id}", json={"assigned_to_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        # a second, unassigned alert
        _seed_alert(owner_id)
        return owner, member_id

    def test_filter_me_returns_only_my_alerts(self, client):
        owner, member_id = self._setup(client)
        resp = client.get("/api/v1/alerts/", params={"assigned": "me"}, headers=owner)
        assert resp.status_code == 200
        rows = resp.json()["alerts"]
        assert all(r["assigned_to_id"] is not None for r in rows) or len(rows) == 0
        assert resp.json()["total"] == 0  # both alerts: one assigned to member, one unassigned

    def test_filter_unassigned_excludes_assigned(self, client):
        owner, member_id = self._setup(client)
        resp = client.get("/api/v1/alerts/", params={"assigned": "unassigned"}, headers=owner)
        assert resp.status_code == 200
        rows = resp.json()["alerts"]
        assert resp.json()["total"] == 1
        assert rows[0]["assigned_to_id"] is None
