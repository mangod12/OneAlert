"""Tests for deleting draft/rejected response plans via DELETE /api/v1/response-plans/{id}."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.response_plan import ApprovalRequest, ResponsePlan

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_plan_delete.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_plan_delete.db"
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


def _make_plan(client: TestClient, headers, status: str, with_approval: bool = False) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        case = Case(user_id=uid, title="Case", status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        plan = ResponsePlan(
            case_id=case.id, user_id=uid, actions=[{"type": "isolate"}],
            status=status, autonomy_level="L1",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        if with_approval:
            db.add(ApprovalRequest(plan_id=plan.id, status="pending", reason="needs review"))
            db.commit()
        return plan.id


def _plan_status(plan_id: int):
    with _TestingSessionLocal() as db:
        return db.get(ResponsePlan, plan_id)


class TestResponsePlanDelete:
    def test_delete_draft_plan_removes_it_and_its_approvals(self, client):
        headers = _register_and_login(client, "d1@example.com")
        plan_id = _make_plan(client, headers, "draft", with_approval=True)

        resp = client.delete(f"/api/v1/response-plans/{plan_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True

        assert _plan_status(plan_id) is None
        with _TestingSessionLocal() as db:
            remaining = db.query(ApprovalRequest).filter_by(plan_id=plan_id).count()
        assert remaining == 0

    def test_delete_rejected_plan(self, client):
        headers = _register_and_login(client, "d2@example.com")
        plan_id = _make_plan(client, headers, "rejected")

        resp = client.delete(f"/api/v1/response-plans/{plan_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert _plan_status(plan_id) is None

    @pytest.mark.parametrize("status", ["pending_approval", "approved", "executing", "completed"])
    def test_delete_active_plan_rejected(self, client, status):
        headers = _register_and_login(client, "d3@example.com")
        plan_id = _make_plan(client, headers, status)

        resp = client.delete(f"/api/v1/response-plans/{plan_id}", headers=headers)
        assert resp.status_code == 400, resp.text
        assert _plan_status(plan_id) is not None

    def test_delete_other_users_plan_returns_404(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        plan_id = _make_plan(client, owner, "draft")

        resp = client.delete(f"/api/v1/response-plans/{plan_id}", headers=other)
        assert resp.status_code == 404
        assert _plan_status(plan_id) is not None

    def test_delete_missing_plan_returns_404(self, client):
        headers = _register_and_login(client, "d4@example.com")
        resp = client.delete("/api/v1/response-plans/99999", headers=headers)
        assert resp.status_code == 404
