"""Tests for exporting response plans as CSV via GET /api/v1/response-plans/export."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.response_plan import ResponsePlan

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_plan_export.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_plan_export.db"
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


def _make_plan(client: TestClient, headers, status: str, case_title: str,
               actions: list | None = None) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        case = Case(user_id=uid, title=case_title, status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        plan = ResponsePlan(
            case_id=case.id, user_id=uid, actions=actions or [],
            status=status, autonomy_level="L1",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan.id


def _read_csv(resp) -> list[dict]:
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    return list(csv.DictReader(io.StringIO(resp.text)))


class TestResponsePlanExport:
    def test_export_returns_all_plans(self, client):
        headers = _register_and_login(client, "plans@example.com")
        _make_plan(client, headers, "draft", "Case A", actions=[{"type": "isolate"}])
        _make_plan(client, headers, "approved", "Case B")

        resp = client.get("/api/v1/response-plans/export", headers=headers)
        assert "response-plans.csv" in resp.headers["content-disposition"]
        rows = _read_csv(resp)
        assert len(rows) == 2
        assert {r["status"] for r in rows} == {"draft", "approved"}
        by_status = {r["status"]: r for r in rows}
        assert by_status["draft"]["action_count"] == "1"
        assert by_status["approved"]["action_count"] == "0"

    def test_export_honors_status_filter(self, client):
        headers = _register_and_login(client, "filtered@example.com")
        _make_plan(client, headers, "draft", "Case A")
        _make_plan(client, headers, "approved", "Case B")

        rows = _read_csv(client.get(
            "/api/v1/response-plans/export?status=approved", headers=headers,
        ))
        assert len(rows) == 1
        assert rows[0]["status"] == "approved"

    def test_export_only_own_plans(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        _make_plan(client, owner, "draft", "Case A")

        rows = _read_csv(client.get("/api/v1/response-plans/export", headers=other))
        assert rows == []


@pytest.mark.parametrize('value', ['=1+1', '+cmd', '-1+2', '@SUM(1)', '  =1', '\t+cmd', '\r@cmd', '\n-cmd'])
def test_plan_export_protects_recorded_actor_text_and_preserves_counts(client, value):
    headers = _register_and_login(client, 'plan-csv-safety@example.com')
    plan_id = _make_plan(client, headers, 'draft', 'Case')
    with _TestingSessionLocal() as db:
        record = db.get(ResponsePlan, plan_id)
        record.created_by = value
        db.commit()
    row = _read_csv(client.get('/api/v1/response-plans/export', headers=headers))[0]
    assert row['created_by'] == "'" + value
    assert row['action_count'] == '0'
    assert row['id'] == str(plan_id)
    with _TestingSessionLocal() as db:
        assert db.get(ResponsePlan, plan_id).created_by == value


def test_case_plan_pages_have_owner_scoped_totals_and_stable_tied_creation_order(client):
    from datetime import UTC, datetime

    owner = _register_and_login(client, 'case-page-owner@example.com')
    first_id = _make_plan(client, owner, 'partial', 'Paged case')
    with _TestingSessionLocal() as db:
        first = db.get(ResponsePlan, first_id)
        case_id, user_id = first.case_id, first.user_id
        first.created_at = datetime(2026, 11, 21, tzinfo=UTC)
        ids = [first.id]
        for index in range(24):
            row = ResponsePlan(case_id=case_id, user_id=user_id, status='partial', autonomy_level='L1',
                               created_at=first.created_at, actions=[{'action_type': 'notify', 'target': str(index)}])
            db.add(row)
            db.flush()
            ids.append(row.id)
        db.commit()
    _make_plan(client, owner, 'draft', 'Other case')
    other = _register_and_login(client, 'case-page-other@example.com')
    other_id = _make_plan(client, other, 'partial', 'Private other case')
    pages = [client.get('/api/v1/response-plans/', headers=owner,
                        params={'case_id': case_id, 'page': page, 'size': 10}).json() for page in (1, 2, 3)]
    assert [value['total'] for value in pages] == [25, 25, 25]
    assert [len(value['data']) for value in pages] == [10, 10, 5]
    returned = [row['id'] for value in pages for row in value['data']]
    assert returned == sorted(ids, reverse=True)
    assert other_id not in returned
    assert all(row['case_id'] == case_id for value in pages for row in value['data'])
    filtered = client.get('/api/v1/response-plans/', headers=owner,
                          params={'case_id': case_id, 'status': 'draft', 'size': 10}).json()
    assert filtered['total'] == 0 and filtered['data'] == []
