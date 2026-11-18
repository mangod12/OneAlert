"""Tests for personal API tokens: create/list/revoke and Bearer authentication."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.api_token import ApiToken

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_api_tokens.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_api_tokens.db"
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


def _create_token(client: TestClient, headers, name: str = "CI bot", **kwargs):
    return client.post("/api/v1/api-tokens/", headers=headers, json={"name": name, **kwargs})


class TestApiTokens:
    def test_create_returns_raw_token_once(self, client):
        headers = _register_and_login(client, "create@example.com")
        resp = _create_token(client, headers)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["token"].startswith("oa_")
        assert body["prefix"] == body["token"][:12]

        listing = client.get("/api/v1/api-tokens/", headers=headers)
        assert listing.status_code == 200
        tokens = listing.json()
        assert len(tokens) == 1
        assert tokens[0]["id"] == body["id"]
        assert "token" not in tokens[0]

    def test_token_authenticates_as_owner(self, client):
        headers = _register_and_login(client, "use@example.com")
        raw = _create_token(client, headers).json()["token"]
        resp = client.get("/api/v1/alerts/views/", headers={"Authorization": f"Bearer {raw}"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_unknown_token_rejected(self, client):
        _register_and_login(client, "unknown@example.com")
        resp = client.get(
            "/api/v1/alerts/views/", headers={"Authorization": "Bearer oa_doesnotexist"}
        )
        assert resp.status_code == 401

    def test_revoked_token_rejected(self, client):
        headers = _register_and_login(client, "revoke@example.com")
        body = _create_token(client, headers).json()
        resp = client.delete(f"/api/v1/api-tokens/{body['id']}", headers=headers)
        assert resp.status_code == 204
        resp = client.get(
            "/api/v1/alerts/views/", headers={"Authorization": f"Bearer {body['token']}"}
        )
        assert resp.status_code == 401
        # Second revoke is a 404, and the row stays visible as revoked in the list.
        assert client.delete(f"/api/v1/api-tokens/{body['id']}", headers=headers).status_code == 404
        listed = client.get("/api/v1/api-tokens/", headers=headers).json()
        assert listed[0]["revoked_at"] is not None

    def test_expired_token_rejected(self, client):
        headers = _register_and_login(client, "expire@example.com")
        body = _create_token(client, headers, expires_in_days=1).json()
        assert body["expires_at"] is not None
        with _TestingSessionLocal() as session:
            row = session.query(ApiToken).filter(ApiToken.id == body["id"]).one()
            row.expires_at = datetime.utcnow() - timedelta(days=1)
            session.commit()
        resp = client.get(
            "/api/v1/alerts/views/", headers={"Authorization": f"Bearer {body['token']}"}
        )
        assert resp.status_code == 401

    def test_blank_name_rejected(self, client):
        headers = _register_and_login(client, "blank@example.com")
        assert _create_token(client, headers, name="   ").status_code == 400

    def test_active_token_cap(self, client):
        headers = _register_and_login(client, "cap@example.com")
        for i in range(20):
            resp = _create_token(client, headers, name=f"token {i}")
            assert resp.status_code == 201, resp.text
        assert _create_token(client, headers, name="one too many").status_code == 400

    def test_revoked_tokens_do_not_count_toward_cap(self, client):
        headers = _register_and_login(client, "cap2@example.com")
        first = _create_token(client, headers, name="first").json()
        client.delete(f"/api/v1/api-tokens/{first['id']}", headers=headers)
        for i in range(20):
            resp = _create_token(client, headers, name=f"token {i}")
            assert resp.status_code == 201, resp.text

    def test_isolation_between_users(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        body = _create_token(client, owner).json()
        assert client.get("/api/v1/api-tokens/", headers=other).json() == []
        assert client.delete(f"/api/v1/api-tokens/{body['id']}", headers=other).status_code == 404


class TestReadOnlyTokens:
    def test_read_only_token_can_read(self, client):
        headers = _register_and_login(client, "ro-read@example.com")
        raw = _create_token(client, headers, name="reporting", read_only=True).json()["token"]
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {raw}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "ro-read@example.com"

    def test_read_only_token_cannot_write(self, client):
        headers = _register_and_login(client, "ro-write@example.com")
        raw = _create_token(client, headers, name="reporting", read_only=True).json()["token"]
        token_headers = {"Authorization": f"Bearer {raw}"}
        attempts = [
            ("patch", "/api/v1/auth/me/notification-preferences", {"json": {"notify_min_severity": "high"}}),
            ("post", "/api/v1/auth/me/change-password", {"json": {"current_password": "securepass123", "new_password": "newpass4567"}}),
            ("delete", "/api/v1/api-tokens/1", {}),
        ]
        for method, url, kwargs in attempts:
            resp = getattr(client, method)(url, headers=token_headers, **kwargs)
            assert resp.status_code == 403, f"{method.upper()} {url}: {resp.text}"
            assert "read-only" in resp.json()["error"]["message"]

    def test_write_token_unaffected(self, client):
        headers = _register_and_login(client, "rw@example.com")
        raw = _create_token(client, headers, name="automation").json()["token"]
        token_headers = {"Authorization": f"Bearer {raw}"}
        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"notify_min_severity": "high"},
            headers=token_headers,
        )
        assert resp.status_code == 200, resp.text

    def test_read_only_flag_round_trips(self, client):
        headers = _register_and_login(client, "ro-list@example.com")
        created = _create_token(client, headers, name="reporting", read_only=True).json()
        assert created["read_only"] is True
        default_token = _create_token(client, headers, name="automation").json()
        assert default_token["read_only"] is False
        listing = client.get("/api/v1/api-tokens/", headers=headers).json()
        by_name = {t["name"]: t["read_only"] for t in listing}
        assert by_name == {"reporting": True, "automation": False}
