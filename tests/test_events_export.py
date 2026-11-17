"""Tests for exporting security events as CSV via GET /api/v1/events/export."""

import csv
import io
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.security_event import SecurityEvent

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_events_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_events_export.db"
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


def _make_event(client, headers, **kwargs):
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    event = SecurityEvent(
        user_id=me.json()["id"],
        timestamp=kwargs.pop("timestamp", datetime.now(UTC)),
        event_type=kwargs.pop("event_type", "alert"),
        severity=kwargs.pop("severity", "high"),
        **kwargs,
    )
    with _TestingSessionLocal() as db:
        db.add(event)
        db.commit()
        db.refresh(event)
        return event.id


def _read_csv(resp) -> list[dict]:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert "events.csv" in resp.headers["content-disposition"]
    return list(csv.DictReader(io.StringIO(resp.text)))


class TestEventsExport:
    def test_export_returns_csv_with_events(self, client):
        headers = _register_and_login(client, "analyst@example.com")
        _make_event(
            client, headers, event_type="dns", severity="medium",
            signature="ET DNS Query", category="Info", source_ip="10.0.0.8",
            source_port=5353, dest_ip="10.0.1.10", dest_port=53,
            protocol="udp", action="allowed",
        )

        rows = _read_csv(client.get("/api/v1/events/export", headers=headers))
        assert len(rows) == 1
        row = rows[0]
        assert row["event_type"] == "dns"
        assert row["severity"] == "medium"
        assert row["signature"] == "ET DNS Query"
        assert row["source_ip"] == "10.0.0.8"
        assert row["source_port"] == "5353"
        assert row["dest_port"] == "53"
        assert row["protocol"] == "udp"
        assert row["action"] == "allowed"
        assert row["timestamp"] != ""

    def test_export_respects_severity_and_type_filters(self, client):
        headers = _register_and_login(client, "filters@example.com")
        _make_event(client, headers, severity="critical", event_type="alert", signature="crit-sig")
        _make_event(client, headers, severity="low", event_type="conn", signature="low-sig")

        rows = _read_csv(client.get(
            "/api/v1/events/export?severity=critical&event_type=alert", headers=headers,
        ))
        assert [r["signature"] for r in rows] == ["crit-sig"]

    def test_export_respects_ip_substring_filter(self, client):
        headers = _register_and_login(client, "ipfilter@example.com")
        _make_event(client, headers, source_ip="192.168.7.7", dest_ip="10.0.0.1", signature="src-hit")
        _make_event(client, headers, source_ip="10.0.0.2", dest_ip="192.168.7.9", signature="dst-hit")
        _make_event(client, headers, source_ip="172.16.0.1", dest_ip="10.0.0.3", signature="miss")

        rows = _read_csv(client.get("/api/v1/events/export?ip=192.168.7", headers=headers))
        assert sorted(r["signature"] for r in rows) == ["dst-hit", "src-hit"]

    def test_export_respects_signature_filter(self, client):
        headers = _register_and_login(client, "sigfilter@example.com")
        _make_event(client, headers, signature="ET MALWARE CnC", severity="critical")
        _make_event(client, headers, signature="ET INFO Scan", severity="info")

        rows = _read_csv(client.get("/api/v1/events/export?signature=MALWARE", headers=headers))
        assert [r["signature"] for r in rows] == ["ET MALWARE CnC"]

    def test_export_excludes_other_users_events(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        _make_event(client, other, signature="not-yours")

        rows = _read_csv(client.get("/api/v1/events/export", headers=owner))
        assert rows == []

    def test_export_empty_is_header_only(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/events/export", headers=headers)
        assert resp.status_code == 200
        lines = [line for line in resp.text.strip().splitlines() if line]
        assert len(lines) == 1
        assert lines[0].startswith("id,timestamp,event_type")
