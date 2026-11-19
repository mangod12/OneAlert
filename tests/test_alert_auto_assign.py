"""Tests for POST /api/v1/alerts/auto-assign: spread open alerts across org members."""

from datetime import UTC, datetime

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
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_auto_assign.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_auto_assign.db"
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


def _seed_alerts(user_id: int, count: int, status: str = "pending") -> list[int]:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name="edge-router-01", asset_type="hardware")
        db.add(asset)
        db.flush()
        ids = []
        for i in range(count):
            alert = Alert(
                user_id=user_id, asset_id=asset.id, cve_id=f"CVE-2026-{i:04d}",
                title=f"Alert {i}", severity="high",
                status=status, created_at=datetime(2026, 11, 1, tzinfo=UTC),
            )
            db.add(alert)
            db.flush()
            ids.append(alert.id)
        db.commit()
        return ids


def _share_org(*user_ids: int) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


class TestAutoAssign:
    def test_spreads_alerts_across_members(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        ids = _seed_alerts(owner_id, 4)

        resp = client.post("/api/v1/alerts/auto-assign", json={"alert_ids": ids}, headers=owner)
        assert resp.status_code == 200, resp.text
        assigned = resp.json()["assigned"]
        assert len(assigned) == 4
        counts = {}
        for assignee in assigned.values():
            counts[assignee] = counts.get(assignee, 0) + 1
        # 4 alerts across 2 members: 2 each.
        assert sorted(counts.values()) == [2, 2]

        with _TestingSessionLocal() as db:
            notes = (db.execute(
                select(Notification).where(Notification.kind == "alert_assigned")
            )).scalars().all()
            # Only the member's two assignments notify (owner assigns to others).
            assert len(notes) == counts.get(member_id, 0)
            assert all(n.user_id == member_id for n in notes)

    def test_respects_existing_load(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        ids = _seed_alerts(owner_id, 2)
        with _TestingSessionLocal() as db:
            # Owner already carries two open alerts elsewhere.
            asset = db.execute(select(Asset)).scalar_one()
            for i in range(2):
                db.add(Alert(
                    user_id=owner_id, asset_id=asset.id, title=f"pre {i}",
                    severity="low", status="pending", assigned_to_id=owner_id,
                ))
            db.commit()

        resp = client.post("/api/v1/alerts/auto-assign", json={"alert_ids": ids}, headers=owner)
        assert resp.status_code == 200, resp.text
        assigned = resp.json()["assigned"]
        assert set(assigned.values()) == {member_id}

    def test_skips_resolved_and_foreign_alerts(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        owner_id = _user_id(client, owner)
        other_id = _user_id(client, other)
        open_ids = _seed_alerts(owner_id, 1)
        resolved_ids = _seed_alerts(owner_id, 1, status="resolved")
        foreign_ids = _seed_alerts(other_id, 1)

        resp = client.post(
            "/api/v1/alerts/auto-assign",
            json={"alert_ids": open_ids + resolved_ids + foreign_ids},
            headers=owner,
        )
        assert resp.status_code == 200, resp.text
        assigned = resp.json()["assigned"]
        assert list(assigned.keys()) == [str(open_ids[0])]
        # No org: the owner is the only candidate.
        assert assigned[str(open_ids[0])] == owner_id

    def test_empty_list_is_a_noop(self, client):
        owner = _register_and_login(client, "owner@example.com")
        resp = client.post("/api/v1/alerts/auto-assign", json={"alert_ids": []}, headers=owner)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"assigned": {}}
