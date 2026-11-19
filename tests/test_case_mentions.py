"""Tests for @mentions in case notes."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case, CaseWatcher
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_mentions.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_mentions.db"
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


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _setup(client):
    # Owner plus will@ and sam@ in one org; owner creates a case.
    owner = _register_and_login(client, "owner@example.com")
    will = _register_and_login(client, "will@example.com")
    sam = _register_and_login(client, "sam@example.com")
    owner_id = _user_id(client, owner)
    will_id = _user_id(client, will)
    sam_id = _user_id(client, sam)
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme", slug="acme")
        db.add(org)
        db.commit()
        db.refresh(org)
        for uid in (owner_id, will_id, sam_id):
            user = db.get(User, uid)
            user.org_id = org.id
        case = Case(user_id=owner_id, title="Beaconing host", status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        case_id = case.id
    return owner, will, sam, will_id, sam_id, case_id


def _mention_notes(client, headers):
    feed = client.get("/api/v1/notifications/", headers=headers).json()
    return [n for n in feed["data"] if n["kind"] == "case_mention"]


class TestCaseMentions:
    def test_mention_notifies_and_adds_watcher(self, client):
        owner, will, _, will_id, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@will can you check the beacon cadence?"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text

        notes = _mention_notes(client, will)
        assert len(notes) == 1
        assert notes[0]["title"] == f"owner@example.com mentioned you in case #{case_id}"
        assert "beacon cadence" in notes[0]["body"]
        assert notes[0]["link"] == f"/app/cases/{case_id}"

        # The mention granted watcher access, so the case now opens.
        resp = client.get(f"/api/v1/cases/{case_id}", headers=will)
        assert resp.status_code == 200, resp.text
        with _TestingSessionLocal() as db:
            rows = db.query(CaseWatcher).filter(
                CaseWatcher.case_id == case_id, CaseWatcher.user_id == will_id,
            ).all()
        assert len(rows) == 1

    def test_mention_is_case_insensitive_on_local_part(self, client):
        owner, will, _, _, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@WILL please take a look"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text
        assert len(_mention_notes(client, will)) == 1

    def test_multiple_mentions_notify_each_member(self, client):
        owner, will, sam, _, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@will @sam triage this together"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text
        assert len(_mention_notes(client, will)) == 1
        assert len(_mention_notes(client, sam)) == 1

    def test_self_mention_does_not_notify(self, client):
        owner, _, _, _, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@owner noting for myself"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text
        assert _mention_notes(client, owner) == []

    def test_unknown_mention_is_ignored(self, client):
        owner, _, _, _, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@ghost not a real person"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text

    def test_mention_of_existing_watcher_notifies_without_duplicating(self, client):
        owner, will, _, will_id, _, case_id = _setup(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@will thoughts?"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text
        assert len(_mention_notes(client, will)) == 1
        with _TestingSessionLocal() as db:
            rows = db.query(CaseWatcher).filter(
                CaseWatcher.case_id == case_id, CaseWatcher.user_id == will_id,
            ).all()
        assert len(rows) == 1

    def test_watcher_author_cannot_pull_in_new_people(self, client):
        owner, will, sam, will_id, sam_id, case_id = _setup(client)
        # will watches; sam has no access. will mentions sam.
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": will_id}, headers=owner)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@sam can you confirm?"},
            headers=will,
        )
        assert resp.status_code in (200, 201), resp.text
        assert _mention_notes(client, sam) == []
        with _TestingSessionLocal() as db:
            rows = db.query(CaseWatcher).filter(
                CaseWatcher.case_id == case_id, CaseWatcher.user_id == sam_id,
            ).all()
        assert rows == []

    def test_assignee_mention_shares_with_new_member(self, client):
        owner, will, sam, will_id, _sam_id, case_id = _setup(client)
        client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": will_id}, headers=owner)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "@sam loop you in"},
            headers=will,
        )
        assert resp.status_code in (200, 201), resp.text
        assert len(_mention_notes(client, sam)) == 1
        resp = client.get(f"/api/v1/cases/{case_id}", headers=sam)
        assert resp.status_code == 200, resp.text

    def test_note_without_mentions_notifies_nobody(self, client):
        owner, will, _, _, _, case_id = _setup(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes",
            json={"content": "plain note, no pings"},
            headers=owner,
        )
        assert resp.status_code in (200, 201), resp.text
        assert _mention_notes(client, will) == []
