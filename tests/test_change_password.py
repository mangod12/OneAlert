"""Tests for the change-password endpoint."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.audit_log import AuditLog
from backend.models.user import User
from backend.services.auth_service import create_access_token

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_change_password.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_change_password.db"
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


class TestChangePassword:
    def test_change_password_success(self, client):
        headers = _register_and_login(client, "change@example.com")
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "securepass123", "new_password": "newpass4567"},
            headers=headers,
        )
        assert resp.status_code == 204, resp.text

        old_login = client.post("/api/v1/auth/login", data={
            "username": "change@example.com", "password": "securepass123",
        })
        assert old_login.status_code == 401
        new_login = client.post("/api/v1/auth/login", data={
            "username": "change@example.com", "password": "newpass4567",
        })
        assert new_login.status_code == 200

        with _TestingSessionLocal() as db:
            entries = db.scalars(
                select(AuditLog).where(AuditLog.action == "password_changed")
            ).all()
            assert len(entries) == 1
            assert entries[0].target_type == "user"

    def test_wrong_current_password_rejected(self, client):
        headers = _register_and_login(client, "wrong@example.com")
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "not-the-password", "new_password": "newpass4567"},
            headers=headers,
        )
        assert resp.status_code == 400, resp.text
        assert "incorrect" in resp.json()["error"]["message"].lower()

    def test_same_password_rejected(self, client):
        headers = _register_and_login(client, "same@example.com")
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "securepass123", "new_password": "securepass123"},
            headers=headers,
        )
        assert resp.status_code == 400, resp.text
        assert "differ" in resp.json()["error"]["message"].lower()

    def test_short_new_password_rejected(self, client):
        headers = _register_and_login(client, "short@example.com")
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "securepass123", "new_password": "short"},
            headers=headers,
        )
        assert resp.status_code == 422, resp.text

    def test_oauth_only_account_has_no_password_to_change(self, client):
        with _TestingSessionLocal() as db:
            user = User(email="oauth@example.com", hashed_password=None, is_active=True)
            db.add(user)
            db.commit()
        token = create_access_token({"sub": "oauth@example.com"})
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "whatever123", "new_password": "newpass4567"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400, resp.text
        assert "no password" in resp.json()["error"]["message"].lower()

    def test_requires_authentication(self, client):
        resp = client.post(
            "/api/v1/auth/me/change-password",
            json={"current_password": "securepass123", "new_password": "newpass4567"},
        )
        assert resp.status_code == 401, resp.text
