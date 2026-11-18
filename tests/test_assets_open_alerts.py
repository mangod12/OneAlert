"""Tests for open_alert_count on GET /api/v1/assets/ (pending + acknowledged alerts per asset)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assets_open_alerts.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_assets_open_alerts.db"
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


def _make_asset(user_id: int, name: str) -> int:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=user_id, name=name, asset_type="hardware", vendor="Acme")
        db.add(asset)
        db.commit()
        return asset.id


def _make_alert(user_id: int, asset_id: int, title: str, status: str = "pending"):
    with _TestingSessionLocal() as db:
        db.add(Alert(
            user_id=user_id,
            asset_id=asset_id,
            title=title,
            description="test alert",
            severity="high",
            status=status,
        ))
        db.commit()


def _counts_by_name(client: TestClient, headers) -> dict[str, int]:
    resp = client.get("/api/v1/assets/", headers=headers)
    assert resp.status_code == 200, resp.text
    return {a["name"]: a["open_alert_count"] for a in resp.json()["assets"]}


class TestAssetOpenAlertCount:
    def test_counts_pending_and_acknowledged_only(self, client):
        headers = _register_and_login(client, "counts@example.com")
        uid = _user_id(client, headers)
        asset_id = _make_asset(uid, "plc-01")
        _make_alert(uid, asset_id, "a1", "pending")
        _make_alert(uid, asset_id, "a2", "acknowledged")
        _make_alert(uid, asset_id, "a3", "resolved")
        assert _counts_by_name(client, headers) == {"plc-01": 2}

    def test_zero_when_no_open_alerts(self, client):
        headers = _register_and_login(client, "zero@example.com")
        uid = _user_id(client, headers)
        asset_id = _make_asset(uid, "edge-01")
        _make_alert(uid, asset_id, "done", "resolved")
        counts = _counts_by_name(client, headers)
        assert counts == {"edge-01": 0}

    def test_counts_are_per_asset_and_owner_scoped(self, client):
        headers_one = _register_and_login(client, "owner1@example.com")
        headers_two = _register_and_login(client, "owner2@example.com")
        uid_one = _user_id(client, headers_one)
        uid_two = _user_id(client, headers_two)
        a1 = _make_asset(uid_one, "mine-a")
        a2 = _make_asset(uid_one, "mine-b")
        other = _make_asset(uid_two, "theirs")
        _make_alert(uid_one, a1, "x1")
        _make_alert(uid_one, a2, "x2")
        _make_alert(uid_one, a2, "x3", "acknowledged")
        _make_alert(uid_two, other, "y1")
        _make_alert(uid_two, other, "y2")
        assert _counts_by_name(client, headers_one) == {"mine-a": 1, "mine-b": 2}
        assert _counts_by_name(client, headers_two) == {"theirs": 2}
