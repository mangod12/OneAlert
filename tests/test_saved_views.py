"""Tests for saved alerts-list filter views."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_saved_views.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_saved_views.db"
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


def _create(client, headers, name="Critical pending", filters=None):
    return client.post("/api/v1/alerts/views/", headers=headers, json={
        "name": name,
        "filters": filters if filters is not None else {
            "severity": "critical", "status": "pending", "sort": "cvss_desc",
        },
    })


class TestSavedViews:
    def test_create_and_list(self, client):
        headers = _register_and_login(client, "views@example.com")
        resp = _create(client, headers)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == "Critical pending"
        assert body["filters"]["severity"] == "critical"
        assert body["filters"]["sort"] == "cvss_desc"

        listing = client.get("/api/v1/alerts/views/", headers=headers)
        assert listing.status_code == 200
        views = listing.json()
        assert len(views) == 1
        assert views[0]["id"] == body["id"]

    def test_empty_filters_allowed(self, client):
        headers = _register_and_login(client, "allalerts@example.com")
        resp = _create(client, headers, name="Everything", filters={})
        assert resp.status_code == 201, resp.text

    def test_unknown_filter_key_rejected(self, client):
        headers = _register_and_login(client, "strict@example.com")
        resp = _create(client, headers, filters={"not_a_filter": "x"})
        assert resp.status_code == 422

    def test_duplicate_name_rejected_case_insensitive(self, client):
        headers = _register_and_login(client, "dupe@example.com")
        assert _create(client, headers).status_code == 201
        resp = _create(client, headers, name="critical PENDING")
        assert resp.status_code == 409

    def test_blank_name_rejected(self, client):
        headers = _register_and_login(client, "blank@example.com")
        resp = _create(client, headers, name="   ")
        assert resp.status_code == 400

    def test_delete(self, client):
        headers = _register_and_login(client, "delete@example.com")
        view_id = _create(client, headers).json()["id"]
        resp = client.delete(f"/api/v1/alerts/views/{view_id}", headers=headers)
        assert resp.status_code == 204
        assert client.get("/api/v1/alerts/views/", headers=headers).json() == []
        assert client.delete(f"/api/v1/alerts/views/{view_id}", headers=headers).status_code == 404

    def test_isolation_between_users(self, client):
        owner = _register_and_login(client, "owner2@example.com")
        other = _register_and_login(client, "other2@example.com")
        view_id = _create(client, owner).json()["id"]
        assert client.get("/api/v1/alerts/views/", headers=other).json() == []
        assert client.delete(f"/api/v1/alerts/views/{view_id}", headers=other).status_code == 404

    def test_per_user_cap(self, client):
        headers = _register_and_login(client, "cap@example.com")
        for i in range(25):
            resp = _create(client, headers, name=f"view {i}")
            assert resp.status_code == 201, resp.text
        resp = _create(client, headers, name="one too many")
        assert resp.status_code == 400


def _create_case_view(client, headers, name="Overdue criticals", filters=None):
    return client.post("/api/v1/cases/views/", headers=headers, json={
        "name": name,
        "filters": filters if filters is not None else {
            "severity": "critical", "overdue": True, "sort": "due_date_asc",
        },
    })


class TestCaseScopeViews:
    def test_create_and_list_cases_views(self, client):
        headers = _register_and_login(client, "caseviews@example.com")
        resp = _create_case_view(client, headers)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["scope"] == "cases"
        assert body["filters"]["overdue"] is True
        assert body["filters"]["sort"] == "due_date_asc"

        listing = client.get("/api/v1/cases/views/", headers=headers)
        assert [v["id"] for v in listing.json()] == [body["id"]]

    def test_scopes_are_isolated(self, client):
        headers = _register_and_login(client, "isolated@example.com")
        alerts_view = _create(client, headers).json()
        cases_view = _create_case_view(client, headers).json()
        assert alerts_view["scope"] == "alerts"

        alerts_listing = client.get("/api/v1/alerts/views/", headers=headers).json()
        cases_listing = client.get("/api/v1/cases/views/", headers=headers).json()
        assert [v["id"] for v in alerts_listing] == [alerts_view["id"]]
        assert [v["id"] for v in cases_listing] == [cases_view["id"]]

        # Cross-scope delete does not touch the other list's view.
        assert client.delete(
            f"/api/v1/cases/views/{alerts_view['id']}", headers=headers
        ).status_code == 404
        assert client.delete(
            f"/api/v1/alerts/views/{cases_view['id']}", headers=headers
        ).status_code == 404

    def test_same_name_allowed_across_scopes(self, client):
        headers = _register_and_login(client, "samename@example.com")
        assert _create(client, headers, name="Mine").status_code == 201
        assert _create_case_view(client, headers, name="Mine").status_code == 201

    def test_alerts_only_filter_key_rejected_for_cases(self, client):
        headers = _register_and_login(client, "strictcases@example.com")
        resp = _create_case_view(client, headers, filters={"asset_id": 3})
        assert resp.status_code == 422
        resp = _create_case_view(client, headers, filters={"not_a_filter": 1})
        assert resp.status_code == 422


def _create_event_view(client, headers, name="Critical DNS", filters=None):
    return client.post("/api/v1/events/views/", headers=headers, json={
        "name": name,
        "filters": filters if filters is not None else {
            "severity": "critical", "event_type": "dns", "ip": "10.0.0.8",
            "sort": "timestamp_desc",
        },
    })


class TestEventScopeViews:
    def test_create_and_list_events_views(self, client):
        headers = _register_and_login(client, "eventviews@example.com")
        resp = _create_event_view(client, headers)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["scope"] == "events"
        assert body["filters"]["event_type"] == "dns"
        assert body["filters"]["ip"] == "10.0.0.8"

        listing = client.get("/api/v1/events/views/", headers=headers)
        assert [v["id"] for v in listing.json()] == [body["id"]]

    def test_events_scope_isolated_from_alerts_and_cases(self, client):
        headers = _register_and_login(client, "evtisolated@example.com")
        alerts_view = _create(client, headers).json()
        events_view = _create_event_view(client, headers).json()

        events_listing = client.get("/api/v1/events/views/", headers=headers).json()
        alerts_listing = client.get("/api/v1/alerts/views/", headers=headers).json()
        assert [v["id"] for v in events_listing] == [events_view["id"]]
        assert [v["id"] for v in alerts_listing] == [alerts_view["id"]]

        assert client.delete(
            f"/api/v1/events/views/{alerts_view['id']}", headers=headers
        ).status_code == 404
        assert client.delete(
            f"/api/v1/alerts/views/{events_view['id']}", headers=headers
        ).status_code == 404

    def test_non_events_filter_key_rejected(self, client):
        headers = _register_and_login(client, "strictevents@example.com")
        resp = _create_event_view(client, headers, filters={"status": "open"})
        assert resp.status_code == 422
        resp = _create_event_view(client, headers, filters={"asset_id": 3})
        assert resp.status_code == 422

    def test_delete_events_view(self, client):
        headers = _register_and_login(client, "evtdelete@example.com")
        view = _create_event_view(client, headers).json()
        assert client.delete(
            f"/api/v1/events/views/{view['id']}", headers=headers
        ).status_code == 204
        assert client.get("/api/v1/events/views/", headers=headers).json() == []


class TestRenameView:
    def test_rename_keeps_filters(self, client):
        headers = _register_and_login(client, "rename@example.com")
        view = _create(client, headers).json()
        resp = client.patch(
            f"/api/v1/alerts/views/{view['id']}", headers=headers,
            json={"name": "Renamed view"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed view"
        assert body["filters"]["severity"] == "critical"
        listing = client.get("/api/v1/alerts/views/", headers=headers).json()
        assert listing[0]["name"] == "Renamed view"

    def test_rename_trims_whitespace(self, client):
        headers = _register_and_login(client, "trim@example.com")
        view = _create(client, headers).json()
        resp = client.patch(
            f"/api/v1/alerts/views/{view['id']}", headers=headers,
            json={"name": "  Trimmed  "},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Trimmed"

    def test_rename_blank_name_rejected(self, client):
        headers = _register_and_login(client, "renameblank@example.com")
        view = _create(client, headers).json()
        resp = client.patch(
            f"/api/v1/alerts/views/{view['id']}", headers=headers,
            json={"name": "   "},
        )
        assert resp.status_code == 400

    def test_rename_to_own_name_allowed(self, client):
        headers = _register_and_login(client, "ownname@example.com")
        view = _create(client, headers).json()
        resp = client.patch(
            f"/api/v1/alerts/views/{view['id']}", headers=headers,
            json={"name": "critical PENDING"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "critical PENDING"

    def test_rename_duplicate_name_rejected(self, client):
        headers = _register_and_login(client, "renamedupe@example.com")
        _create(client, headers, name="Taken")
        other = _create(client, headers, name="Original").json()
        resp = client.patch(
            f"/api/v1/alerts/views/{other['id']}", headers=headers,
            json={"name": "taken"},
        )
        assert resp.status_code == 409

    def test_rename_not_found_and_cross_scope(self, client):
        headers = _register_and_login(client, "notfound@example.com")
        alerts_view = _create(client, headers).json()
        assert client.patch(
            "/api/v1/alerts/views/9999", headers=headers, json={"name": "x"},
        ).status_code == 404
        # Same id through another list's path does not touch the alerts view.
        assert client.patch(
            f"/api/v1/cases/views/{alerts_view['id']}", headers=headers,
            json={"name": "x"},
        ).status_code == 404

    def test_rename_other_users_view_not_found(self, client):
        owner = _register_and_login(client, "renowner@example.com")
        other = _register_and_login(client, "renother@example.com")
        view = _create(client, owner).json()
        resp = client.patch(
            f"/api/v1/alerts/views/{view['id']}", headers=other,
            json={"name": "hijack"},
        )
        assert resp.status_code == 404
        listing = client.get("/api/v1/alerts/views/", headers=owner).json()
        assert listing[0]["name"] == "Critical pending"
