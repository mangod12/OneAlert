"""Tests for editing case timeline notes via PATCH /api/v1/cases/{id}/notes/{entry_id}."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_note_edit.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_note_edit.db"
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


def _make_case(client: TestClient, headers, title="Case for note edits") -> int:
    resp = client.post("/api/v1/cases/", json={"title": title, "severity": "high"}, headers=headers)
    assert resp.status_code == 201, f"Case creation failed: {resp.text}"
    return resp.json()["id"]


def _add_note(client: TestClient, headers, case_id: int, content="Initial observation") -> dict:
    resp = client.post(f"/api/v1/cases/{case_id}/notes", json={"content": content}, headers=headers)
    assert resp.status_code == 201, f"Note creation failed: {resp.text}"
    return resp.json()


class TestCaseNoteEdit:
    def test_edit_note_updates_content(self, client):
        headers = _register_and_login(client, "owner@example.com")
        case_id = _make_case(client, headers)
        note = _add_note(client, headers, case_id)

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/{note['id']}",
            json={"content": "Corrected observation"},
            headers=headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == note["id"]
        assert body["content"] == "Corrected observation"
        assert body["metadata_json"]["edited"] is True

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        edited = [e for e in detail.json()["timeline"] if e["id"] == note["id"]]
        assert edited[0]["content"] == "Corrected observation"

    def test_edit_note_strips_whitespace(self, client):
        headers = _register_and_login(client, "ws@example.com")
        case_id = _make_case(client, headers)
        note = _add_note(client, headers, case_id)

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/{note['id']}",
            json={"content": "  trimmed text  "},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "trimmed text"

    def test_edit_blank_note_rejected(self, client):
        headers = _register_and_login(client, "blank@example.com")
        case_id = _make_case(client, headers)
        note = _add_note(client, headers, case_id)

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/{note['id']}",
            json={"content": "   "},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_edit_missing_note_404(self, client):
        headers = _register_and_login(client, "missing@example.com")
        case_id = _make_case(client, headers)

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/99999",
            json={"content": "nope"},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_edit_note_in_other_users_case_404(self, client):
        owner = _register_and_login(client, "owner2@example.com")
        intruder = _register_and_login(client, "intruder@example.com")
        case_id = _make_case(client, owner)
        note = _add_note(client, owner, case_id)

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/{note['id']}",
            json={"content": "hijacked"},
            headers=intruder,
        )
        assert resp.status_code == 404

        detail = client.get(f"/api/v1/cases/{case_id}", headers=owner)
        edited = [e for e in detail.json()["timeline"] if e["id"] == note["id"]]
        assert edited[0]["content"] == "Initial observation"

    def test_edit_note_from_another_case_404(self, client):
        headers = _register_and_login(client, "twocases@example.com")
        case_a = _make_case(client, headers, "Case A")
        case_b = _make_case(client, headers, "Case B")
        note = _add_note(client, headers, case_a)

        resp = client.patch(
            f"/api/v1/cases/{case_b}/notes/{note['id']}",
            json={"content": "wrong case"},
            headers=headers,
        )
        assert resp.status_code == 404

    def test_non_note_entry_not_editable(self, client):
        from backend.models.case import CaseTimeline

        headers = _register_and_login(client, "systementry@example.com")
        case_id = _make_case(client, headers)

        with _TestingSessionLocal() as db:
            entry = CaseTimeline(
                case_id=case_id,
                entry_type="action",
                content="Automated containment executed",
                source="agent",
            )
            db.add(entry)
            db.commit()
            db.refresh(entry)
            entry_id = entry.id

        resp = client.patch(
            f"/api/v1/cases/{case_id}/notes/{entry_id}",
            json={"content": "should fail"},
            headers=headers,
        )
        assert resp.status_code == 422
