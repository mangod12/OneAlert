"""Tests for the on-call rotation: endpoints, rotation math, auto-assign integration."""

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
from backend.models.organization import Organization
from backend.models.user import User
from backend.services.assignment import auto_assignee_id
from backend.services.oncall import rotation_member_id

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_on_call.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_on_call.db"
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


def _make_admin(user_id: int) -> None:
    with _TestingSessionLocal() as db:
        db.get(User, user_id).role = "admin"
        db.commit()


def _share_org(*user_ids: int) -> int:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()
        return org.id


class TestRotationMath:
    def test_weekly_handoff(self):
        anchor = date(2026, 11, 2)  # Monday
        assert rotation_member_id([10, 20], anchor, date(2026, 11, 2)) == 10
        assert rotation_member_id([10, 20], anchor, date(2026, 11, 8)) == 10
        assert rotation_member_id([10, 20], anchor, date(2026, 11, 9)) == 20
        assert rotation_member_id([10, 20], anchor, date(2026, 11, 16)) == 10

    def test_three_members(self):
        anchor = date(2026, 11, 2)
        assert rotation_member_id([10, 20, 30], anchor, date(2026, 11, 16)) == 30
        assert rotation_member_id([10, 20, 30], anchor, date(2026, 11, 23)) == 10
        assert rotation_member_id([10, 20, 30], anchor, date(2026, 11, 30)) == 20

    def test_today_before_anchor_stays_first(self):
        anchor = date(2026, 11, 9)
        assert rotation_member_id([10, 20], anchor, date(2026, 11, 2)) == 10


class TestOnCallEndpoints:
    def test_set_and_read_rotation(self, client):
        admin = _register_and_login(client, "admin@example.com")
        member = _register_and_login(client, "member@example.com")
        admin_id = _user_id(client, admin)
        member_id = _user_id(client, member)
        _make_admin(admin_id)
        _share_org(admin_id, member_id)

        resp = client.patch(
            "/api/v1/orgs/me/on-call", json={"member_ids": [member_id, admin_id]}, headers=admin,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["member_ids"] == [member_id, admin_id]
        assert body["anchor_date"] == datetime.now(UTC).date().isoformat()
        assert body["current_member_id"] == member_id

        read = client.get("/api/v1/orgs/me/on-call", headers=member)
        assert read.status_code == 200
        assert read.json()["member_ids"] == [member_id, admin_id]

    def test_non_admin_cannot_set(self, client):
        admin = _register_and_login(client, "admin@example.com")
        member = _register_and_login(client, "member@example.com")
        admin_id = _user_id(client, admin)
        member_id = _user_id(client, member)
        _share_org(admin_id, member_id)

        resp = client.patch(
            "/api/v1/orgs/me/on-call", json={"member_ids": [member_id]}, headers=member,
        )
        assert resp.status_code == 403

    def test_rejects_non_members(self, client):
        admin = _register_and_login(client, "admin@example.com")
        outsider = _register_and_login(client, "outsider@example.com")
        admin_id = _user_id(client, admin)
        outsider_id = _user_id(client, outsider)
        _make_admin(admin_id)
        _share_org(admin_id)

        resp = client.patch(
            "/api/v1/orgs/me/on-call", json={"member_ids": [outsider_id]}, headers=admin,
        )
        assert resp.status_code == 400

    def test_empty_list_disables(self, client):
        admin = _register_and_login(client, "admin@example.com")
        member = _register_and_login(client, "member@example.com")
        admin_id = _user_id(client, admin)
        member_id = _user_id(client, member)
        _make_admin(admin_id)
        _share_org(admin_id, member_id)

        client.patch("/api/v1/orgs/me/on-call", json={"member_ids": [member_id]}, headers=admin)
        resp = client.patch("/api/v1/orgs/me/on-call", json={"member_ids": []}, headers=admin)
        assert resp.status_code == 200
        body = resp.json()
        assert body["member_ids"] == []
        assert body["anchor_date"] is None
        assert body["current_member_id"] is None


class TestAutoAssignOnCall:
    @pytest.mark.asyncio
    async def test_auto_assign_picks_on_call_member(self, client):
        admin = _register_and_login(client, "admin@example.com")
        member = _register_and_login(client, "member@example.com")
        admin_id = _user_id(client, admin)
        member_id = _user_id(client, member)
        _make_admin(admin_id)
        _share_org(admin_id, member_id)
        client.patch("/api/v1/orgs/me/on-call", json={"member_ids": [member_id]}, headers=admin)
        with _TestingSessionLocal() as db:
            db.get(User, admin_id).auto_assign_new_alerts = True
            # Admin has no load, member has two open alerts; rotation still wins.
            asset = Asset(user_id=admin_id, name="edge-router", asset_type="hardware")
            db.add(asset)
            db.flush()
            for i in range(2):
                db.add(Alert(
                    user_id=admin_id, asset_id=asset.id, title=f"a{i}",
                    severity="high", status="pending", assigned_to_id=member_id,
                ))
            db.commit()

        async with _AsyncTestingSessionLocal() as db:
            user = await db.get(User, admin_id)
            assert await auto_assignee_id(db, user) == member_id

    @pytest.mark.asyncio
    async def test_stale_rotation_falls_back_to_balancing(self, client):
        admin = _register_and_login(client, "admin@example.com")
        member = _register_and_login(client, "member@example.com")
        admin_id = _user_id(client, admin)
        member_id = _user_id(client, member)
        _make_admin(admin_id)
        _share_org(admin_id, member_id)
        client.patch("/api/v1/orgs/me/on-call", json={"member_ids": [member_id]}, headers=admin)
        with _TestingSessionLocal() as db:
            db.get(User, admin_id).auto_assign_new_alerts = True
            db.get(User, member_id).is_active = False  # on-call member left
            db.commit()

        async with _AsyncTestingSessionLocal() as db:
            user = await db.get(User, admin_id)
            # Member inactive: no rotation candidate, and <2 active members.
            assert await auto_assignee_id(db, user) is None
