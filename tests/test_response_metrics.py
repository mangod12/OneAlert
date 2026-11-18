"""Tests for GET /api/v1/alerts/stats/response-metrics (MTTA / MTTR)."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_response_metrics.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_response_metrics.db"
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


def _make_alert(
    client: TestClient,
    headers,
    *,
    created_at: datetime,
    acknowledged_at: datetime | None = None,
    resolved_at: datetime | None = None,
    status: str = "pending",
) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="plc-01", asset_type="hardware")
        db.add(asset)
        db.commit()
        db.refresh(asset)
        alert = Alert(
            user_id=uid, asset_id=asset.id, title="Timed alert",
            severity="high", status=status,
            created_at=created_at,
            acknowledged_at=acknowledged_at,
            resolved_at=resolved_at,
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert.id


NOW = datetime.now(UTC).replace(tzinfo=None)


class TestResponseMetrics:
    def test_empty_when_no_activity(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/alerts/stats/response-metrics", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["days"] == 30
        assert data["acknowledged_count"] == 0
        assert data["resolved_count"] == 0
        assert data["mtta_seconds"] is None
        assert data["mttr_seconds"] is None

    def test_means_over_window(self, client):
        headers = _register_and_login(client, "means@example.com")
        created = NOW - timedelta(hours=10)
        _make_alert(
            client, headers,
            created_at=created,
            acknowledged_at=created + timedelta(hours=1),
            resolved_at=created + timedelta(hours=4),
            status="resolved",
        )
        _make_alert(
            client, headers,
            created_at=created,
            acknowledged_at=created + timedelta(hours=3),
            resolved_at=created + timedelta(hours=6),
            status="resolved",
        )

        resp = client.get("/api/v1/alerts/stats/response-metrics", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["acknowledged_count"] == 2
        assert data["resolved_count"] == 2
        assert data["mtta_seconds"] == pytest.approx(2 * 3600, abs=1)
        assert data["mttr_seconds"] == pytest.approx(5 * 3600, abs=1)

    def test_activity_outside_window_excluded(self, client):
        headers = _register_and_login(client, "window@example.com")
        created = NOW - timedelta(days=40)
        _make_alert(
            client, headers,
            created_at=created,
            acknowledged_at=created + timedelta(hours=1),
            resolved_at=created + timedelta(hours=2),
            status="resolved",
        )

        resp = client.get("/api/v1/alerts/stats/response-metrics?days=30", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["acknowledged_count"] == 0
        assert data["resolved_count"] == 0
        assert data["mtta_seconds"] is None
        assert data["mttr_seconds"] is None

    def test_days_parameter_validated(self, client):
        headers = _register_and_login(client, "param@example.com")
        assert client.get(
            "/api/v1/alerts/stats/response-metrics?days=0", headers=headers
        ).status_code == 422
        assert client.get(
            "/api/v1/alerts/stats/response-metrics?days=91", headers=headers
        ).status_code == 422

    def test_metrics_scoped_to_owner(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        created = NOW - timedelta(hours=5)
        _make_alert(
            client, owner,
            created_at=created,
            acknowledged_at=created + timedelta(hours=1),
            resolved_at=created + timedelta(hours=2),
            status="resolved",
        )

        resp = client.get("/api/v1/alerts/stats/response-metrics", headers=other)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["acknowledged_count"] == 0
        assert data["resolved_count"] == 0
        assert data["mtta_seconds"] is None

    def test_resolve_and_reopen_set_and_clear_resolved_at(self, client):
        headers = _register_and_login(client, "flow@example.com")
        alert_id = _make_alert(client, headers, created_at=NOW - timedelta(hours=1))

        resp = client.post(f"/api/v1/alerts/{alert_id}/resolve", headers=headers)
        assert resp.status_code == 200, resp.text

        detail = client.get(f"/api/v1/alerts/{alert_id}", headers=headers)
        assert detail.json()["resolved_at"] is not None

        metrics = client.get("/api/v1/alerts/stats/response-metrics", headers=headers)
        assert metrics.json()["resolved_count"] == 1

        reopen = client.post(f"/api/v1/alerts/{alert_id}/reopen", headers=headers)
        assert reopen.status_code == 200, reopen.text

        detail = client.get(f"/api/v1/alerts/{alert_id}", headers=headers)
        assert detail.json()["resolved_at"] is None

        metrics = client.get("/api/v1/alerts/stats/response-metrics", headers=headers)
        assert metrics.json()["resolved_count"] == 0
