"""Tests for GET /api/v1/mitre/techniques/{technique_id}/references."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.detection_rule import DetectionRule
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_mitre_references.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_mitre_references.db"
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
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed(email: str) -> None:
    """Seed one case and one detection rule referencing T1190 for the user."""
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        db.add(Case(
            user_id=user.id,
            title="Web shell on dmz-proxy",
            severity="high",
            status="open",
            mitre_techniques=[{"id": "T1190", "name": "Exploit Public-Facing Application"}],
        ))
        db.add(Case(
            user_id=user.id,
            title="Unrelated phishing review",
            severity="low",
            status="closed",
            mitre_techniques=["T1078"],
        ))
        db.add(DetectionRule(
            user_id=user.id,
            name="Exploit attempt pattern",
            rule_type="sigma",
            rule_content="title: exploit attempt",
            mitre_techniques=["T1190"],
            enabled=True,
        ))
        db.commit()


class TestTechniqueReferences:
    def test_lists_referencing_cases_and_rules(self, client):
        headers = _register_and_login(client, "analyst@example.com")
        _seed("analyst@example.com")
        res = client.get("/api/v1/mitre/techniques/T1190/references", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["technique_id"] == "T1190"
        assert body["technique_name"] == "Exploit Public-Facing Application"
        assert [c["title"] for c in body["cases"]] == ["Web shell on dmz-proxy"]
        assert body["cases"][0]["status"] == "open"
        assert [r["name"] for r in body["detection_rules"]] == ["Exploit attempt pattern"]
        assert body["detection_rules"][0]["enabled"] is True

    def test_string_entries_match(self, client):
        headers = _register_and_login(client, "strings@example.com")
        _seed("strings@example.com")
        res = client.get("/api/v1/mitre/techniques/T1078/references", headers=headers)
        assert res.status_code == 200
        assert [c["title"] for c in res.json()["cases"]] == ["Unrelated phishing review"]

    def test_empty_for_uncovered_technique(self, client):
        headers = _register_and_login(client, "quiet@example.com")
        _seed("quiet@example.com")
        res = client.get("/api/v1/mitre/techniques/T1046/references", headers=headers)
        assert res.status_code == 200
        assert res.json()["cases"] == []
        assert res.json()["detection_rules"] == []

    def test_unknown_technique_returns_404(self, client):
        headers = _register_and_login(client, "lost@example.com")
        res = client.get("/api/v1/mitre/techniques/T9999/references", headers=headers)
        assert res.status_code == 404

    def test_other_users_references_hidden(self, client):
        _register_and_login(client, "owner@example.com")
        _seed("owner@example.com")
        headers_b = _register_and_login(client, "peer@example.com")
        res = client.get("/api/v1/mitre/techniques/T1190/references", headers=headers_b)
        assert res.status_code == 200
        assert res.json()["cases"] == []
        assert res.json()["detection_rules"] == []

    def test_requires_auth(self, client):
        client.cookies.clear()
        res = client.get("/api/v1/mitre/techniques/T1190/references")
        assert res.status_code == 401
