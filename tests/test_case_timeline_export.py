"""Tests for exporting a case timeline as CSV via GET /api/v1/cases/{id}/export."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_timeline_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_timeline_export.db"
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
        "email": email, "password": password, "full_name": "Case Owner",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _make_case(client: TestClient, headers, title="Incident 42") -> int:
    resp = client.post("/api/v1/cases/", json={"title": title, "severity": "high"}, headers=headers)
    assert resp.status_code == 201, f"Case creation failed: {resp.text}"
    return resp.json()["id"]


def _read_csv(resp) -> list[dict]:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    return list(csv.DictReader(io.StringIO(resp.text)))


class TestCaseTimelineExport:
    def test_export_includes_opening_entry_and_notes_in_order(self, client):
        headers = _register_and_login(client, "owner@example.com")
        case_id = _make_case(client, headers)
        client.post(f"/api/v1/cases/{case_id}/notes", json={"content": "First finding"}, headers=headers)
        client.post(f"/api/v1/cases/{case_id}/notes", json={"content": "Second finding"}, headers=headers)

        resp = client.get(f"/api/v1/cases/{case_id}/export", headers=headers)
        assert f"case-{case_id}-timeline.csv" in resp.headers["content-disposition"]
        rows = _read_csv(resp)
        assert len(rows) == 3
        assert rows[0]["case_title"] == "Incident 42"
        assert rows[0]["entry_type"] == "note"
        assert "opened manually" in rows[0]["content"]
        assert rows[1]["content"] == "First finding"
        assert rows[2]["content"] == "Second finding"
        assert all(r["timestamp"] != "" for r in rows)

    def test_export_other_users_case_404(self, client):
        owner = _register_and_login(client, "owner2@example.com")
        intruder = _register_and_login(client, "intruder@example.com")
        case_id = _make_case(client, owner)

        resp = client.get(f"/api/v1/cases/{case_id}/export", headers=intruder)
        assert resp.status_code == 404

    def test_export_missing_case_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        resp = client.get("/api/v1/cases/99999/export", headers=headers)
        assert resp.status_code == 404


@pytest.mark.parametrize('value', ['=1+1', '+cmd', '-1+2', '@SUM(1)', '  =1', '\t+cmd', '\r@cmd', '\n-cmd'])
def test_timeline_csv_protects_titles_sources_and_notes_without_rewriting_them(client, value):
    from backend.models.case import Case, CaseTimeline
    headers = _register_and_login(client, 'timeline-csv-safety@example.com')
    case_id = _make_case(client, headers, title=value)
    with _TestingSessionLocal() as db:
        db.get(Case, case_id).title = value
        entry = CaseTimeline(case_id=case_id, entry_type='note', source=value, content=value)
        db.add(entry)
        db.commit()
        entry_id = entry.id
    rows = _read_csv(client.get(f'/api/v1/cases/{case_id}/export', headers=headers))
    row = next(row for row in rows if row['source'] == "'" + value)
    assert row['case_title'] == row['content'] == "'" + value
    assert row['case_id'] == str(case_id)
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, entry_id).content == value
