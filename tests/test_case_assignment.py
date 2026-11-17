"""Tests for assigning cases to organization members via POST /api/v1/cases/{id}/assign."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_assignment.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_assignment.db"
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


def _create_case(client: TestClient, headers) -> int:
    resp = client.post("/api/v1/cases/", json={"title": "Suspicious login burst", "severity": "high"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _share_org(*user_ids: int) -> None:
    """Put the given users into one organization."""
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


class TestCaseAssignment:
    def test_assign_to_org_member(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        case_id = _create_case(client, owner)

        resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        assert resp.json()["assigned_to_id"] == member_id
        assert resp.json()["assigned_to_email"] == "member@example.com"

        listing = client.get("/api/v1/cases/", headers=owner)
        row = listing.json()["cases"][0]
        assert row["assigned_to_id"] == member_id
        assert row["assigned_to_email"] == "member@example.com"

        detail = client.get(f"/api/v1/cases/{case_id}", headers=owner)
        assert detail.json()["assigned_to_email"] == "member@example.com"

    def test_unassign_with_null(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        case_id = _create_case(client, owner)

        resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": None}, headers=owner)
        assert resp.status_code == 200, resp.text
        assert resp.json()["assigned_to_id"] is None
        listing = client.get("/api/v1/cases/", headers=owner)
        assert listing.json()["cases"][0]["assigned_to_id"] is None

    def test_assign_unknown_user_returns_400(self, client):
        owner = _register_and_login(client, "owner@example.com")
        case_id = _create_case(client, owner)

        resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": 99999}, headers=owner)
        assert resp.status_code == 400, resp.text

    def test_assign_outside_org_returns_400(self, client):
        owner = _register_and_login(client, "owner@example.com")
        outsider = _register_and_login(client, "outsider@example.com")
        owner_id = _user_id(client, owner)
        outsider_id = _user_id(client, outsider)
        _share_org(owner_id)  # outsider stays org-less
        case_id = _create_case(client, owner)

        resp = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": outsider_id}, headers=owner)
        assert resp.status_code == 400, resp.text

    def test_assign_missing_case_returns_404(self, client):
        owner = _register_and_login(client, "owner@example.com")
        owner_id = _user_id(client, owner)

        resp = client.post("/api/v1/cases/424242/assign", json={"user_id": owner_id}, headers=owner)
        assert resp.status_code == 404, resp.text


class TestCaseAssignmentFilter:
    def _setup(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        assigned_case = _create_case(client, owner)
        resp = client.post(f"/api/v1/cases/{assigned_case}/assign", json={"user_id": owner_id}, headers=owner)
        assert resp.status_code == 200, resp.text
        _create_case(client, owner)  # unassigned
        return owner

    def test_filter_me_returns_only_my_cases(self, client):
        owner = self._setup(client)
        resp = client.get("/api/v1/cases/", params={"assigned": "me"}, headers=owner)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["cases"][0]["assigned_to_email"] == "owner@example.com"

    def test_filter_unassigned_excludes_assigned(self, client):
        owner = self._setup(client)
        resp = client.get("/api/v1/cases/", params={"assigned": "unassigned"}, headers=owner)
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["cases"][0]["assigned_to_id"] is None
