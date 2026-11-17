"""Tests for GET /api/v1/auth/audit-logs ordering and limit."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.audit_log import AuditLog
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_audit_logs.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_audit_logs.db"
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


def _register_admin_and_login(client: TestClient, email: str, password: str = "securepass123"):
    """Register a user, promote them to admin, and return auth headers."""
    reg = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": password,
        "full_name": f"User {email.split('@')[0]}",
        "company": "TestCorp",
    })
    assert reg.status_code == 201, f"Registration failed: {reg.text}"
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        user.role = "admin"
        db.commit()
    login = client.post("/api/v1/auth/login", data={
        "username": email,
        "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _add_logs(email: str, count: int):
    """Attach `count` audit rows with increasing timestamps to the user."""
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        base = datetime(2026, 11, 1, tzinfo=UTC)
        for i in range(count):
            db.add(AuditLog(
                user_id=user.id,
                action=f"action_{i}",
                target_type="asset",
                target_id=i,
                detail=f"detail {i}",
                timestamp=base + timedelta(minutes=i),
            ))
        db.commit()


class TestAuditLogOrdering:
    def test_newest_first(self, client):
        headers = _register_admin_and_login(client, "admin@example.com")
        _add_logs("admin@example.com", 3)
        res = client.get("/api/v1/auth/audit-logs", headers=headers)
        assert res.status_code == 200
        actions = [log["action"] for log in res.json()]
        assert actions == ["action_2", "action_1", "action_0"]

    def test_capped_at_500(self, client):
        headers = _register_admin_and_login(client, "admin2@example.com")
        _add_logs("admin2@example.com", 505)
        res = client.get("/api/v1/auth/audit-logs", headers=headers)
        assert res.status_code == 200
        logs = res.json()
        assert len(logs) == 500
        assert logs[0]["action"] == "action_504"

    def test_non_admin_forbidden(self, client):
        reg = client.post("/api/v1/auth/register", json={
            "email": "viewer@example.com",
            "password": "securepass123",
            "full_name": "Viewer",
            "company": "TestCorp",
        })
        assert reg.status_code == 201
        login = client.post("/api/v1/auth/login", data={
            "username": "viewer@example.com",
            "password": "securepass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        res = client.get("/api/v1/auth/audit-logs", headers=headers)
        assert res.status_code == 403
