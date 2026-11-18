"""Tests for GET /api/v1/alerts/{id}/cases (investigations containing the alert)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_alert_cases.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_alert_cases.db"
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


def _make_alert(uid: int, title: str = "Modbus write burst") -> int:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        alert = Alert(user_id=uid, asset_id=asset.id, title=title, severity="high")
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


def _link_case(uid: int, alert_id: int, title: str, status: str = "open") -> int:
    with _TestingSessionLocal() as db:
        case = Case(user_id=uid, title=title, severity="high", status=status)
        db.add(case)
        db.commit()
        db.refresh(case)
        db.add(CaseAlert(case_id=case.id, alert_id=alert_id))
        db.commit()
        return case.id


class TestAlertCases:
    def test_lists_linked_cases(self, client):
        headers = _register_and_login(client, "linked@example.com")
        uid = _user_id(client, headers)
        alert_id = _make_alert(uid)
        _link_case(uid, alert_id, "Line 3 investigation")
        _link_case(uid, alert_id, "Follow-up review", status="resolved")
        resp = client.get(f"/api/v1/alerts/{alert_id}/cases", headers=headers)
        assert resp.status_code == 200, resp.text
        cases = resp.json()
        assert len(cases) == 2
        titles = {c["title"] for c in cases}
        assert titles == {"Line 3 investigation", "Follow-up review"}
        for c in cases:
            assert set(c) == {"id", "title", "status", "severity", "created_at"}

    def test_empty_when_unlinked(self, client):
        headers = _register_and_login(client, "unlinked@example.com")
        uid = _user_id(client, headers)
        alert_id = _make_alert(uid)
        resp = client.get(f"/api/v1/alerts/{alert_id}/cases", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    def test_unknown_alert_is_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        resp = client.get("/api/v1/alerts/9999/cases", headers=headers)
        assert resp.status_code == 404

    def test_other_users_alert_is_404_and_cases_hidden(self, client):
        owner = _register_and_login(client, "ac_owner@example.com")
        other = _register_and_login(client, "ac_other@example.com")
        uid = _user_id(client, owner)
        alert_id = _make_alert(uid)
        _link_case(uid, alert_id, "Private case")
        resp = client.get(f"/api/v1/alerts/{alert_id}/cases", headers=other)
        assert resp.status_code == 404
        # The owner's own list still shows the case.
        resp = client.get(f"/api/v1/alerts/{alert_id}/cases", headers=owner)
        assert len(resp.json()) == 1

    def test_other_users_case_not_listed(self, client):
        """A link row pointing at someone else's case must not leak through."""
        headers = _register_and_login(client, "isolated@example.com")
        other_headers = _register_and_login(client, "isolated2@example.com")
        uid = _user_id(client, headers)
        other_uid = _user_id(client, other_headers)
        alert_id = _make_alert(uid)
        _link_case(other_uid, alert_id, "Foreign case")
        resp = client.get(f"/api/v1/alerts/{alert_id}/cases", headers=headers)
        assert resp.json() == []
