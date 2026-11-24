"""Tests for case watchers: read access, watch management, update notifications."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_watchers.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_watchers.db"
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


def _seed_watchlist_actor(client: TestClient, email: str):
    """Seed a fresh workflow identity; retain production token/database checks.

    Authentication endpoints keep their own registration/login tests. No shared
    password cache, password-hash override or authorization dependency override.
    """
    from backend.models.user import User
    from backend.services.auth_service import create_access_token

    with _TestingSessionLocal() as db:
        db.add(User(email=email, hashed_password=None, full_name="Analyst",
                    is_active=True, is_verified=False))
        db.commit()
    headers = {"Authorization": f"Bearer {create_access_token({'sub': email})}"}
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["email"] == email
    return headers


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _setup_org_with_case(client):
    # Owner and two members in one org; owner creates a case.
    owner = _seed_watchlist_actor(client, "owner@example.com")
    member = _seed_watchlist_actor(client, "member@example.com")
    member2 = _seed_watchlist_actor(client, "member2@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    member2_id = _user_id(client, member2)
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme", slug="acme")
        db.add(org)
        db.commit()
        db.refresh(org)
        for uid in (owner_id, member_id, member2_id):
            user = db.get(User, uid)
            user.org_id = org.id
        case = Case(user_id=owner_id, title="Beaconing host", status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        case_id = case.id
    return owner, member, member2, owner_id, member_id, member2_id, case_id


class TestWatchManagement:
    def test_owner_adds_watcher_and_member_is_notified(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        watchers = resp.json()
        assert [w["user_id"] for w in watchers] == [member_id]
        assert watchers[0]["email"] == "member@example.com"

        feed = client.get("/api/v1/notifications/", headers=member).json()
        notes = [n for n in feed["data"] if n["kind"] == "case_watching"]
        assert len(notes) == 1
        assert notes[0]["title"] == f"You are now watching case #{case_id}"
        assert notes[0]["link"] == f"/app/cases/{case_id}"

    def test_add_watcher_is_idempotent_and_notifies_once(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        for _ in range(2):
            resp = client.post(
                f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner,
            )
            assert resp.status_code == 200, resp.text
        assert len(resp.json()) == 1
        feed = client.get("/api/v1/notifications/", headers=member).json()
        notes = [n for n in feed["data"] if n["kind"] == "case_watching"]
        assert len(notes) == 1

    def test_watcher_must_be_org_member(self, client):
        owner, _, _, _, _, _, case_id = _setup_org_with_case(client)
        outsider = _seed_watchlist_actor(client, "outsider@example.com")
        outsider_id = _user_id(client, outsider)
        resp = client.post(
            f"/api/v1/cases/{case_id}/watchers", json={"user_id": outsider_id}, headers=owner,
        )
        assert resp.status_code == 400, resp.text

    def test_non_owner_cannot_add_watchers(self, client):
        _owner, member, _member2, _, _, member2_id, case_id = _setup_org_with_case(client)
        resp = client.post(
            f"/api/v1/cases/{case_id}/watchers", json={"user_id": member2_id}, headers=member,
        )
        assert resp.status_code == 404, resp.text

    def test_self_watch_and_unwatch_are_idempotent(self, client):
        owner, _, _, _, _, _, case_id = _setup_org_with_case(client)
        for _ in range(2):
            resp = client.post(f"/api/v1/cases/{case_id}/watch", headers=owner)
            assert resp.status_code == 200 and resp.json()["watching"] is True
        resp = client.get(f"/api/v1/cases/{case_id}/watchers", headers=owner)
        assert len(resp.json()) == 1
        for _ in range(2):
            resp = client.delete(f"/api/v1/cases/{case_id}/watch", headers=owner)
            assert resp.status_code == 200 and resp.json()["watching"] is False
        resp = client.get(f"/api/v1/cases/{case_id}/watchers", headers=owner)
        assert resp.json() == []

    def test_owner_removes_watcher_and_watcher_self_removes(self, client):
        owner, _member, member2, _, member_id, member2_id, case_id = _setup_org_with_case(client)
        for uid in (member_id, member2_id):
            client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": uid}, headers=owner)
        resp = client.delete(f"/api/v1/cases/{case_id}/watchers/{member_id}", headers=owner)
        assert resp.status_code == 204, resp.text
        resp = client.delete(f"/api/v1/cases/{case_id}/watchers/{member2_id}", headers=member2)
        assert resp.status_code == 204, resp.text
        resp = client.get(f"/api/v1/cases/{case_id}/watchers", headers=owner)
        assert resp.json() == []

    def test_watcher_cannot_remove_other_watchers(self, client):
        owner, member, _member2, _, member_id, member2_id, case_id = _setup_org_with_case(client)
        for uid in (member_id, member2_id):
            client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": uid}, headers=owner)
        resp = client.delete(f"/api/v1/cases/{case_id}/watchers/{member2_id}", headers=member)
        assert resp.status_code == 403, resp.text


class TestWatcherAccess:
    def test_watcher_can_read_case_and_notes(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        # Before watching: no access.
        resp = client.get(f"/api/v1/cases/{case_id}", headers=member)
        assert resp.status_code == 404
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)
        # After watching: read access plus note participation.
        resp = client.get(f"/api/v1/cases/{case_id}", headers=member)
        assert resp.status_code == 200, resp.text
        resp = client.post(
            f"/api/v1/cases/{case_id}/notes", json={"content": "Watching this one"}, headers=member,
        )
        assert resp.status_code in (200, 201), resp.text

    def test_watcher_is_read_only_for_case_updates(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=critical", headers=member)
        assert resp.status_code == 403, resp.text
        assert "read-only" in resp.json()["error"]["message"]
        resp = client.patch(f"/api/v1/cases/{case_id}?status_update=investigating", headers=member)
        assert resp.status_code == 403, resp.text

    def test_unwatching_removes_read_access(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.get(f"/api/v1/cases/{case_id}", headers=member)
        assert resp.status_code == 200
        resp = client.delete(f"/api/v1/cases/{case_id}/watchers/{member_id}", headers=owner)
        assert resp.status_code == 204
        resp = client.get(f"/api/v1/cases/{case_id}", headers=member)
        assert resp.status_code == 404


class TestWatcherNotifications:
    def test_owner_severity_change_notifies_watcher(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=critical", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 1
        assert "severity high -> critical" in updates[0]["body"]

    def test_status_change_notifies_watchers_not_assignee_actor(self, client):
        owner, member, member2, _, member_id, member2_id, case_id = _setup_org_with_case(client)
        # member2 is the assignee; member watches the case.
        client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": member2_id}, headers=owner)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?status_update=investigating", headers=member2,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 1
        assert "status open -> investigating" in updates[0]["body"]
        # The assignee made the change and gets no self-notification.
        feed2 = client.get("/api/v1/notifications/", headers=member2).json()
        updates2 = [n for n in feed2["data"] if n["kind"] == "case_updated"]
        assert updates2 == []

    def test_assignee_watcher_gets_single_notification(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner)
        client.post(f"/api/v1/cases/{case_id}/watch", headers=member)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?severity=critical&status_update=investigating",
            headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 1
        assert "severity high -> critical" in updates[0]["body"]
        assert "status open -> investigating" in updates[0]["body"]

    def test_actor_watching_own_case_stays_silent(self, client):
        owner, _, _, _, _, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watch", headers=owner)
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=critical", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=owner).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []


class TestWatchedByMeFilter:
    def test_watching_me_lists_watched_cases_across_the_org(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)

        resp = client.get("/api/v1/cases/?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        ids = [c["id"] for c in resp.json()["cases"]]
        assert ids == [case_id]

    def test_watching_me_excludes_unwatched_cases(self, client):
        owner, member, member2, _, _, _, case_id = _setup_org_with_case(client)
        # member watches nothing; member2 watches the case.
        resp = client.get("/api/v1/cases/?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        assert resp.json()["cases"] == []
        assert resp.json()["total"] == 0

        member2_id = _user_id(client, member2)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member2_id}, headers=owner)
        resp = client.get("/api/v1/cases/?watching=me", headers=member2)
        assert [c["id"] for c in resp.json()["cases"]] == [case_id]

    def test_watching_me_rejects_invalid_values(self, client):
        _, member, _, _, _, _, _ = _setup_org_with_case(client)
        resp = client.get("/api/v1/cases/?watching=everyone", headers=member)
        assert resp.status_code == 422, resp.text

    def test_export_csv_honors_watching_me(self, client):
        owner, member, _, _, member_id, _, case_id = _setup_org_with_case(client)
        client.post(f"/api/v1/cases/{case_id}/watchers", json={"user_id": member_id}, headers=owner)

        resp = client.get("/api/v1/cases/export?watching=me", headers=member)
        assert resp.status_code == 200, resp.text
        assert "Beaconing host" in resp.text

        other = _seed_watchlist_actor(client, "nobody@example.com")
        resp = client.get("/api/v1/cases/export?watching=me", headers=other)
        assert resp.status_code == 200, resp.text
        assert "Beaconing host" not in resp.text


def test_watching_and_assigned_filters_intersect_for_list_count_and_export(client):
    import csv
    import io

    from backend.models.case import CaseWatcher

    owner, member, _, owner_id, member_id, _, first_id = _setup_org_with_case(client)
    with _TestingSessionLocal() as db:
        first = db.get(Case, first_id)
        first.assigned_to_id = member_id
        other = Case(user_id=owner_id, title='Watched but assigned elsewhere', status='open',
                     severity='high', assigned_to_id=owner_id)
        db.add(other)
        db.flush()
        db.add_all([CaseWatcher(case_id=first.id, user_id=member_id),
                    CaseWatcher(case_id=other.id, user_id=member_id)])
        db.commit()
    params = {'watching': 'me', 'assigned': 'me'}
    result = client.get('/api/v1/cases/', params=params, headers=member).json()
    assert result['total'] == 1
    assert [row['id'] for row in result['cases']] == [first_id]
    export = client.get('/api/v1/cases/export', params=params, headers=member)
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert [int(row['id']) for row in rows] == [first_id]
