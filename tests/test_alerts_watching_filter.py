"""Tests for the alerts list 'watching=me' filter (list + CSV export)."""

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

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alerts_watching_filter.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alerts_watching_filter.db"
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
    """Owner and member in one org; owner has two alerts, member has one."""
    owner = _register_and_login(client, "owner@example.com")
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
        asset = Asset(user_id=owner_id, name="edge-router-01", asset_type="hardware", vendor="Acme", product="RouterOS")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        watched_alert = Alert(
            user_id=owner_id, asset_id=asset.id, cve_id="CVE-2026-1001",
            title="RouterOS remote code execution", severity="critical",
            status="pending", created_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
        other_alert = Alert(
            user_id=owner_id, asset_id=asset.id, cve_id="CVE-2026-1002",
            title="RouterOS information disclosure", severity="medium",
            status="pending", created_at=datetime(2026, 11, 2, tzinfo=UTC),
        )
        member_alert = Alert(
            user_id=member_id, asset_id=asset.id, cve_id="CVE-2026-1003",
            title="Member's own alert", severity="low",
            status="pending", created_at=datetime(2026, 11, 3, tzinfo=UTC),
        )
        db.add_all([watched_alert, other_alert, member_alert])
        db.commit()
        db.refresh(watched_alert)
        db.refresh(other_alert)
        db.refresh(member_alert)
        ids = (watched_alert.id, other_alert.id, member_alert.id)
    return owner, member, member_id, ids


class TestAlertsWatchingFilter:
    def test_watching_me_spans_the_org(self, client):
        owner, member, member_id, (watched_id, _, _) = _setup(client)
        resp = client.post(
            f"/api/v1/alerts/{watched_id}/watchers", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text

        resp = client.get("/api/v1/alerts/?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["total"] == 1
        assert [a["id"] for a in data["alerts"]] == [watched_id]

    def test_watching_me_excludes_own_unwatched_alerts(self, client):
        owner, member, member_id, (watched_id, _, member_alert_id) = _setup(client)
        resp = client.post(
            f"/api/v1/alerts/{watched_id}/watchers", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text

        resp = client.get("/api/v1/alerts/?watching=me", headers=member)
        returned = [a["id"] for a in resp.json()["alerts"]]
        assert member_alert_id not in returned

        # Without the filter the member only sees their own alert.
        resp = client.get("/api/v1/alerts/", headers=member)
        assert [a["id"] for a in resp.json()["alerts"]] == [member_alert_id]

    def test_watching_me_empty_when_nothing_watched(self, client):
        _, member, _, _ = _setup(client)
        resp = client.get("/api/v1/alerts/?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 0
        assert resp.json()["alerts"] == []

    def test_unwatched_alert_drops_out(self, client):
        owner, member, member_id, (watched_id, _, _) = _setup(client)
        client.post(f"/api/v1/alerts/{watched_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.delete(f"/api/v1/alerts/{watched_id}/watch", headers=member)
        assert resp.status_code == 200, resp.text
        resp = client.get("/api/v1/alerts/?watching=me", headers=member)
        assert resp.json()["total"] == 0

    def test_watching_rejects_invalid_values(self, client):
        _, member, _, _ = _setup(client)
        resp = client.get("/api/v1/alerts/?watching=all", headers=member)
        assert resp.status_code == 422, resp.text

    def test_export_honors_watching_me(self, client):
        owner, member, member_id, (watched_id, _, _) = _setup(client)
        client.post(f"/api/v1/alerts/{watched_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.get("/api/v1/alerts/export?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        csv_text = resp.text
        assert "CVE-2026-1001" in csv_text
        assert "CVE-2026-1002" not in csv_text
        assert "CVE-2026-1003" not in csv_text
