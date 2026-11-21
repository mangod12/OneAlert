"""Tests for case due dates: PATCH set/clear, overdue filter, due-date sorting."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.routers import cases as cases_router

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_due_dates.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_due_dates.db"
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
def client(monkeypatch):
    """Use the same fixed UTC request clock and fixture dates, even across midnight."""
    monkeypatch.setattr(cases_router, "datetime", FixedDateTime)
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


def _make_case(client: TestClient, headers, title: str = "A case") -> int:
    res = client.post("/api/v1/cases/", json={"title": title, "severity": "high"}, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _set_due(client: TestClient, headers, case_id: int, value: str) -> None:
    res = client.patch(
        f"/api/v1/cases/{case_id}", params={"due_date": value}, headers=headers
    )
    assert res.status_code == 200, res.text


FIXED_NOW = datetime(2026, 11, 21, 19, 30, tzinfo=UTC)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_NOW.astimezone(tz) if tz is not None else FIXED_NOW.replace(tzinfo=None)


TODAY = FIXED_NOW.date().isoformat()
YESTERDAY = (FIXED_NOW.date() - timedelta(days=1)).isoformat()
TOMORROW = (FIXED_NOW.date() + timedelta(days=1)).isoformat()
NEXT_WEEK = (FIXED_NOW.date() + timedelta(days=7)).isoformat()


class TestCaseDueDates:
    def test_due_date_defaults_to_none(self, client):
        headers = _register_and_login(client, "none@example.com")
        case_id = _make_case(client, headers)
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["due_date"] is None

    def test_set_due_date(self, client):
        headers = _register_and_login(client, "set@example.com")
        case_id = _make_case(client, headers)
        _set_due(client, headers, case_id, TOMORROW)
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["due_date"] == TOMORROW

    def test_omitted_due_date_leaves_it_unchanged(self, client):
        headers = _register_and_login(client, "keep@example.com")
        case_id = _make_case(client, headers)
        _set_due(client, headers, case_id, TOMORROW)
        res = client.patch(
            f"/api/v1/cases/{case_id}", params={"title": "Renamed"}, headers=headers
        )
        assert res.status_code == 200
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["due_date"] == TOMORROW

    def test_empty_due_date_clears_it(self, client):
        headers = _register_and_login(client, "clear@example.com")
        case_id = _make_case(client, headers)
        _set_due(client, headers, case_id, TOMORROW)
        _set_due(client, headers, case_id, "")
        got = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert got.json()["due_date"] is None

    def test_invalid_due_date_rejected(self, client):
        headers = _register_and_login(client, "bad@example.com")
        case_id = _make_case(client, headers)
        res = client.patch(
            f"/api/v1/cases/{case_id}", params={"due_date": "next-friday"}, headers=headers
        )
        assert res.status_code == 400

    def test_overdue_filter(self, client):
        headers = _register_and_login(client, "overdue@example.com")
        past_open = _make_case(client, headers, "past open")
        past_resolved = _make_case(client, headers, "past resolved")
        future_open = _make_case(client, headers, "future open")
        no_due = _make_case(client, headers, "no due date")
        due_today = _make_case(client, headers, "due today UTC")
        _set_due(client, headers, due_today, TODAY)
        _set_due(client, headers, past_open, YESTERDAY)
        _set_due(client, headers, past_resolved, YESTERDAY)
        _set_due(client, headers, future_open, TOMORROW)
        client.patch(
            f"/api/v1/cases/{past_resolved}", params={"status_update": "resolved"}, headers=headers
        )

        res = client.get("/api/v1/cases/?overdue=true", headers=headers)
        assert res.status_code == 200
        returned = {c["id"] for c in res.json()["cases"]}
        assert returned == {past_open}
        assert no_due not in returned
        assert due_today not in returned

    def test_sort_by_due_date_nulls_last(self, client):
        headers = _register_and_login(client, "sort@example.com")
        no_due = _make_case(client, headers, "no due")
        later = _make_case(client, headers, "later")
        sooner = _make_case(client, headers, "sooner")
        _set_due(client, headers, later, NEXT_WEEK)
        _set_due(client, headers, sooner, TOMORROW)

        res = client.get("/api/v1/cases/?sort=due_date_asc", headers=headers)
        assert res.status_code == 200
        ids = [c["id"] for c in res.json()["cases"]]
        assert ids.index(sooner) < ids.index(later) < ids.index(no_due)

    def test_list_response_includes_due_date(self, client):
        headers = _register_and_login(client, "list@example.com")
        case_id = _make_case(client, headers)
        _set_due(client, headers, case_id, TOMORROW)
        res = client.get("/api/v1/cases/", headers=headers)
        due_dates = {c["id"]: c["due_date"] for c in res.json()["cases"]}
        assert due_dates[case_id] == TOMORROW
