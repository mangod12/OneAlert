"""Tests for audit-trail coverage of security-relevant mutations."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.audit_log import AuditLog

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_audit_trail.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_audit_trail.db"
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


def _audit_rows(action: str) -> list[AuditLog]:
    with _TestingSessionLocal() as db:
        return list(db.execute(select(AuditLog).where(AuditLog.action == action)).scalars().all())


class TestApiTokenAudit:
    def test_token_creation_is_audited(self, client):
        headers = _register_and_login(client, "tokens@example.com")
        res = client.post("/api/v1/api-tokens/", headers=headers, json={"name": "ci bot", "read_only": True})
        assert res.status_code == 201
        rows = _audit_rows("api_token_created")
        assert len(rows) == 1
        assert rows[0].target_type == "api_token"
        assert rows[0].target_id == res.json()["id"]
        assert "ci bot" in rows[0].detail
        # The raw token must never land in the audit trail.
        assert res.json()["token"] not in (rows[0].detail or "")

    def test_token_revocation_is_audited(self, client):
        headers = _register_and_login(client, "tokens2@example.com")
        created = client.post("/api/v1/api-tokens/", headers=headers, json={"name": "old token"})
        token_id = created.json()["id"]
        res = client.delete(f"/api/v1/api-tokens/{token_id}", headers=headers)
        assert res.status_code == 204
        rows = _audit_rows("api_token_revoked")
        assert len(rows) == 1
        assert rows[0].target_id == token_id


class TestIntegrationAudit:
    def _create(self, client, headers, name="Prod pager") -> int:
        res = client.post("/api/v1/integrations/", headers=headers, json={
            "integration_type": "pagerduty",
            "name": name,
            "config": {"routing_key": "abc123"},
        })
        assert res.status_code == 201, f"Integration creation failed: {res.text}"
        return res.json()["data"]["id"]

    def test_integration_creation_is_audited(self, client):
        headers = _register_and_login(client, "siem@example.com")
        integration_id = self._create(client, headers)
        rows = _audit_rows("integration_created")
        assert len(rows) == 1
        assert rows[0].target_id == integration_id
        assert "pagerduty" in rows[0].detail

    def test_integration_update_is_audited(self, client):
        headers = _register_and_login(client, "siem2@example.com")
        integration_id = self._create(client, headers)
        res = client.patch(f"/api/v1/integrations/{integration_id}", headers=headers, json={"name": "Renamed"})
        assert res.status_code == 200
        rows = _audit_rows("integration_updated")
        assert len(rows) == 1
        assert rows[0].target_id == integration_id

    def test_integration_deletion_is_audited(self, client):
        headers = _register_and_login(client, "siem3@example.com")
        integration_id = self._create(client, headers)
        res = client.delete(f"/api/v1/integrations/{integration_id}", headers=headers)
        assert res.status_code == 200
        rows = _audit_rows("integration_deleted")
        assert len(rows) == 1
        assert rows[0].target_id == integration_id


class TestCaseAudit:
    def test_case_creation_is_audited(self, client):
        headers = _register_and_login(client, "cases@example.com")
        res = client.post("/api/v1/cases/", headers=headers, json={
            "title": "Manual investigation",
            "summary": "Opened by hand",
            "severity": "medium",
        })
        assert res.status_code == 201, f"Case creation failed: {res.text}"
        rows = _audit_rows("case_created")
        assert len(rows) == 1
        assert rows[0].target_id == res.json()["id"]

    def test_case_deletion_is_audited(self, client):
        headers = _register_and_login(client, "cases2@example.com")
        created = client.post("/api/v1/cases/", headers=headers, json={
            "title": "Duplicate case",
            "severity": "low",
        })
        case_id = created.json()["id"]
        res = client.delete(f"/api/v1/cases/{case_id}", headers=headers)
        assert res.status_code == 204
        rows = _audit_rows("case_deleted")
        assert len(rows) == 1
        assert rows[0].target_id == case_id
        assert "Duplicate case" in rows[0].detail
