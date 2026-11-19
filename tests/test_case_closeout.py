"""Tests for case close-out records: closed_at transitions and resolution summaries."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_closeout.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_closeout.db"
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


def _share_org(*user_ids: int) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


def _make_case(client: TestClient, headers, title: str = "Ransomware on plant-historian") -> int:
    res = client.post("/api/v1/cases/", json={"title": title, "severity": "high"}, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def test_closing_sets_closed_at_and_resolution(client):
    headers = _register_and_login(client, "owner@example.com")
    case_id = _make_case(client, headers)
    res = client.patch(
        f"/api/v1/cases/{case_id}",
        params={"status_update": "closed", "resolution": "Contained and re-imaged."},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    got = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    assert got["status"] == "closed"
    assert got["closed_at"] is not None
    assert got["resolution"] == "Contained and re-imaged."


def test_reopen_clears_closed_at(client):
    headers = _register_and_login(client, "owner@example.com")
    case_id = _make_case(client, headers)
    client.patch(f"/api/v1/cases/{case_id}", params={"status_update": "resolved"}, headers=headers)
    got = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    assert got["closed_at"] is not None
    client.patch(f"/api/v1/cases/{case_id}", params={"status_update": "open"}, headers=headers)
    got = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    assert got["status"] == "open"
    assert got["closed_at"] is None


def test_moving_between_done_statuses_keeps_original_closed_at(client):
    headers = _register_and_login(client, "owner@example.com")
    case_id = _make_case(client, headers)
    client.patch(f"/api/v1/cases/{case_id}", params={"status_update": "resolved"}, headers=headers)
    first = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()["closed_at"]
    client.patch(f"/api/v1/cases/{case_id}", params={"status_update": "closed"}, headers=headers)
    second = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()["closed_at"]
    assert first == second


def test_resolution_editable_and_clearable(client):
    headers = _register_and_login(client, "owner@example.com")
    case_id = _make_case(client, headers)
    client.patch(f"/api/v1/cases/{case_id}", params={"resolution": "Initial finding"}, headers=headers)
    got = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    assert got["resolution"] == "Initial finding"
    client.patch(f"/api/v1/cases/{case_id}", params={"resolution": "   "}, headers=headers)
    got = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    assert got["resolution"] is None


def test_assignee_cannot_set_resolution(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    _share_org(_user_id(client, owner), _user_id(client, member))
    case_id = _make_case(client, owner)
    res = client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": _user_id(client, member)}, headers=owner)
    assert res.status_code == 200, res.text
    res = client.patch(f"/api/v1/cases/{case_id}", params={"resolution": "Nope"}, headers=member)
    assert res.status_code == 403
    # The assignee can still close the case.
    res = client.patch(f"/api/v1/cases/{case_id}", params={"status_update": "closed"}, headers=member)
    assert res.status_code == 200, res.text
    got = client.get(f"/api/v1/cases/{case_id}", headers=owner).json()
    assert got["closed_at"] is not None
    assert got["resolution"] is None
