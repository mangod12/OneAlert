"""Tests for exporting the investigations list as CSV via GET /api/v1/cases/export."""

import csv
import io
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_export.db"
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


def _make_case(client: TestClient, headers, title: str, severity: str = "high", **extra) -> int:
    res = client.post("/api/v1/cases/", json={"title": title, "severity": severity}, headers=headers)
    assert res.status_code in (200, 201), res.text
    case_id = res.json()["id"]
    if extra:
        res = client.patch(f"/api/v1/cases/{case_id}", params=extra, headers=headers)
        assert res.status_code == 200, res.text
    return case_id


def _export(client: TestClient, headers, **params) -> list[dict]:
    res = client.get("/api/v1/cases/export", params=params, headers=headers)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    return list(csv.DictReader(io.StringIO(res.text)))


class TestCaseExport:
    def test_header_and_rows(self, client):
        headers = _register_and_login(client, "export@example.com")
        _make_case(client, headers, "Suspicious logins", severity="critical", due_date="2026-11-30")
        _make_case(client, headers, "Policy drift", severity="low")

        rows = _export(client, headers)
        assert len(rows) == 2
        expected_header = [
            "id", "title", "summary", "severity", "status", "confidence_score",
            "alert_count", "event_count", "assigned_to_email", "due_date", "created_by", "created_at",
        ]
        assert list(rows[0].keys()) == expected_header
        by_title = {row["title"]: row for row in rows}
        assert by_title["Suspicious logins"]["severity"] == "critical"
        assert by_title["Suspicious logins"]["due_date"] == "2026-11-30"
        assert by_title["Suspicious logins"]["alert_count"] == "0"
        assert by_title["Policy drift"]["due_date"] == ""

    def test_filters_apply(self, client):
        headers = _register_and_login(client, "filters@example.com")
        _make_case(client, headers, "critical one", severity="critical")
        _make_case(client, headers, "low one", severity="low")

        rows = _export(client, headers, severity="critical")
        assert [row["title"] for row in rows] == ["critical one"]

        resolved = _make_case(client, headers, "resolved critical", severity="critical")
        client.patch(f"/api/v1/cases/{resolved}", params={"status_update": "resolved"}, headers=headers)
        rows = _export(client, headers, severity="critical", status="resolved")
        assert [row["title"] for row in rows] == ["resolved critical"]

    def test_overdue_filter_applies(self, client):
        headers = _register_and_login(client, "overdue@example.com")
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        _make_case(client, headers, "past due", due_date=yesterday)
        _make_case(client, headers, "not due yet", due_date=tomorrow)
        _make_case(client, headers, "no date")

        rows = _export(client, headers, overdue="true")
        assert [row["title"] for row in rows] == ["past due"]

    def test_owner_scoping(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        _make_case(client, owner, "owner case")
        rows = _export(client, other)
        assert rows == []
