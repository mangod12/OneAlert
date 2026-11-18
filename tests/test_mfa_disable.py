"""Tests for disabling MFA via POST /api/v1/auth/me/mfa/disable."""

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.audit_log import AuditLog
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_mfa_disable.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_mfa_disable.db"
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


def _enable_mfa(email: str) -> str:
    """Mark the user MFA-enabled with a known secret; return the secret."""
    secret = pyotp.random_base32()
    with _TestingSessionLocal() as db:
        user = db.scalars(select(User).where(User.email == email)).one()
        user.mfa_enabled = True
        user.mfa_secret = secret
        db.commit()
    return secret


class TestMfaDisable:
    def test_disable_with_valid_code(self, client):
        headers = _register_and_login(client, "disable@example.com")
        secret = _enable_mfa("disable@example.com")
        code = pyotp.TOTP(secret).now()
        resp = client.post("/api/v1/auth/me/mfa/disable", json={"code": code}, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() is True

        with _TestingSessionLocal() as db:
            user = db.scalars(select(User).where(User.email == "disable@example.com")).one()
            assert user.mfa_enabled is False
            assert user.mfa_secret is None
            entries = db.scalars(
                select(AuditLog).where(AuditLog.action == "mfa_disabled")
            ).all()
            assert len(entries) == 1

    def test_wrong_code_keeps_mfa_enabled(self, client):
        headers = _register_and_login(client, "wrongcode@example.com")
        secret = _enable_mfa("wrongcode@example.com")
        resp = client.post("/api/v1/auth/me/mfa/disable", json={"code": "000000"}, headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() is False

        with _TestingSessionLocal() as db:
            user = db.scalars(select(User).where(User.email == "wrongcode@example.com")).one()
            assert user.mfa_enabled is True
            assert user.mfa_secret == secret

    def test_disable_when_not_enabled_returns_400(self, client):
        headers = _register_and_login(client, "notenabled@example.com")
        resp = client.post("/api/v1/auth/me/mfa/disable", json={"code": "123456"}, headers=headers)
        assert resp.status_code == 400, resp.text

    def test_requires_authentication(self, client):
        resp = client.post("/api/v1/auth/me/mfa/disable", json={"code": "123456"})
        assert resp.status_code == 401, resp.text
