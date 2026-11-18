"""Tests for GET /api/v1/auth/audit-logs ordering, filtering and pagination."""

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
        body = res.json()
        assert body["total"] == 3
        actions = [log["action"] for log in body["logs"]]
        assert actions == ["action_2", "action_1", "action_0"]

    def test_pagination(self, client):
        headers = _register_admin_and_login(client, "admin2@example.com")
        _add_logs("admin2@example.com", 120)
        res = client.get("/api/v1/auth/audit-logs", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 120
        assert len(body["logs"]) == 50
        assert body["logs"][0]["action"] == "action_119"
        res2 = client.get("/api/v1/auth/audit-logs", params={"page": 3}, headers=headers)
        assert res2.status_code == 200
        body2 = res2.json()
        assert body2["total"] == 120
        assert len(body2["logs"]) == 20
        assert body2["logs"][0]["action"] == "action_19"
        res3 = client.get("/api/v1/auth/audit-logs", params={"size": 200}, headers=headers)
        assert res3.status_code == 200
        assert len(res3.json()["logs"]) == 120

    def test_action_filter(self, client):
        headers = _register_admin_and_login(client, "admin3@example.com")
        _add_logs("admin3@example.com", 25)
        res = client.get("/api/v1/auth/audit-logs", params={"action": "action_2"}, headers=headers)
        assert res.status_code == 200
        body = res.json()
        # action_2 and action_20..action_24 match the substring, newest first
        assert body["total"] == 6
        actions = [log["action"] for log in body["logs"]]
        assert actions == ["action_24", "action_23", "action_22", "action_21", "action_20", "action_2"]

    def test_action_filter_escapes_wildcards(self, client):
        headers = _register_admin_and_login(client, "admin4@example.com")
        _add_logs("admin4@example.com", 5)
        res = client.get("/api/v1/auth/audit-logs", params={"action": "_"}, headers=headers)
        assert res.status_code == 200
        body = res.json()
        # Underscore is escaped, so it matches literally: every action contains "_"
        assert body["total"] == 5

    def test_user_email_filter(self, client):
        headers = _register_admin_and_login(client, "admin5@example.com")
        _add_logs("admin5@example.com", 3)
        res = client.get("/api/v1/auth/audit-logs", params={"user": "admin5@"}, headers=headers)
        assert res.status_code == 200
        assert res.json()["total"] == 3
        res_none = client.get("/api/v1/auth/audit-logs", params={"user": "nobody@"}, headers=headers)
        assert res_none.status_code == 200
        assert res_none.json()["total"] == 0

    def test_date_range_filter(self, client):
        headers = _register_admin_and_login(client, "admin6@example.com")
        _add_logs("admin6@example.com", 10)
        res = client.get("/api/v1/auth/audit-logs", params={
            "from_date": "2026-11-01T00:03:00",
            "to_date": "2026-11-01T00:06:00",
        }, headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 4
        actions = [log["action"] for log in body["logs"]]
        assert actions == ["action_6", "action_5", "action_4", "action_3"]

    def test_from_date_only_filter(self, client):
        headers = _register_admin_and_login(client, "admin7@example.com")
        _add_logs("admin7@example.com", 5)
        res = client.get("/api/v1/auth/audit-logs", params={
            "from_date": "2026-11-01T00:03:00",
        }, headers=headers)
        assert res.status_code == 200
        assert res.json()["total"] == 2

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


class TestAuditLogExport:
    def test_export_csv_newest_first_with_email(self, client):
        headers = _register_admin_and_login(client, "exporter@example.com")
        _add_logs("exporter@example.com", 3)
        res = client.get("/api/v1/auth/audit-logs/export", headers=headers)
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/csv")
        assert "attachment" in res.headers["content-disposition"]
        lines = res.text.strip().splitlines()
        assert lines[0] == "id,timestamp,user_email,action,target_type,target_id,detail"
        assert len(lines) == 4
        assert lines[1].split(",")[3] == "action_2"  # newest first
        assert lines[1].split(",")[2] == "exporter@example.com"

    def test_export_respects_action_filter(self, client):
        headers = _register_admin_and_login(client, "exporter2@example.com")
        _add_logs("exporter2@example.com", 5)
        res = client.get("/api/v1/auth/audit-logs/export", params={"action": "action_1"}, headers=headers)
        assert res.status_code == 200
        lines = res.text.strip().splitlines()
        assert len(lines) == 2
        assert "action_1" in lines[1]

    def test_export_respects_date_and_user_filters(self, client):
        headers = _register_admin_and_login(client, "exporter3@example.com")
        _add_logs("exporter3@example.com", 10)
        res = client.get("/api/v1/auth/audit-logs/export", params={
            "user": "exporter3@",
            "from_date": "2026-11-01T00:02:00",
            "to_date": "2026-11-01T00:04:00",
        }, headers=headers)
        assert res.status_code == 200
        lines = res.text.strip().splitlines()
        assert len(lines) == 4
        assert lines[1].split(",")[3] == "action_4"
        res_none = client.get("/api/v1/auth/audit-logs/export", params={"user": "nobody@"}, headers=headers)
        assert res_none.status_code == 200
        assert len(res_none.text.strip().splitlines()) == 1

    def test_export_non_admin_forbidden(self, client):
        reg = client.post("/api/v1/auth/register", json={
            "email": "viewer2@example.com",
            "password": "securepass123",
            "full_name": "Viewer Two",
            "company": "TestCorp",
        })
        assert reg.status_code == 201
        login = client.post("/api/v1/auth/login", data={
            "username": "viewer2@example.com",
            "password": "securepass123",
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        res = client.get("/api/v1/auth/audit-logs/export", headers=headers)
        assert res.status_code == 403
