"""Tests for GET /api/v1/mitre/coverage combining cases and enabled detection rules."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_mitre_coverage.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_mitre_coverage.db"
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


def _add_case(email: str, techniques: list):
    with _TestingSessionLocal() as db:
        user = db.scalars(select(User).where(User.email == email)).one()
        db.add(Case(user_id=user.id, title="Investigation", mitre_techniques=techniques))
        db.commit()


def _add_rule(client: TestClient, headers, techniques, enabled=True) -> int:
    res = client.post("/api/v1/hunt/detections", json={
        "name": "Rule", "rule_type": "sigma", "rule_content": "title: x",
        "mitre_techniques": techniques,
    }, headers=headers)
    assert res.status_code == 200, f"Rule creation failed: {res.text}"
    rule_id = res.json()["id"]
    if not enabled:
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"enabled": False}, headers=headers)
        assert res.status_code == 200
    return rule_id


def _coverage(client: TestClient, headers) -> dict:
    res = client.get("/api/v1/mitre/coverage", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["data"]


class TestMitreCoverage:
    def test_case_techniques_count(self, client):
        headers = _register_and_login(client, "cov1@example.com")
        _add_case("cov1@example.com", [{"id": "T0855", "name": "Unauthorized Command Message"}])
        data = _coverage(client, headers)
        assert data["covered_techniques"] == 1

    def test_enabled_detection_rules_count(self, client):
        headers = _register_and_login(client, "cov2@example.com")
        _add_rule(client, headers, ["T0843", "T0886"])
        data = _coverage(client, headers)
        assert data["covered_techniques"] == 2

    def test_disabled_rules_do_not_count(self, client):
        headers = _register_and_login(client, "cov3@example.com")
        _add_rule(client, headers, ["T0843"], enabled=False)
        data = _coverage(client, headers)
        assert data["covered_techniques"] == 0

    def test_cases_and_rules_union_without_double_counting(self, client):
        headers = _register_and_login(client, "cov4@example.com")
        _add_case("cov4@example.com", ["T0855"])
        _add_rule(client, headers, ["T0855", "T0843"])
        data = _coverage(client, headers)
        assert data["covered_techniques"] == 2

    def test_other_users_rules_do_not_count(self, client):
        headers = _register_and_login(client, "cov5@example.com")
        other = _register_and_login(client, "cov6@example.com")
        _add_rule(client, other, ["T0843"])
        data = _coverage(client, headers)
        assert data["covered_techniques"] == 0
