"""Tests for audit logging of response-plan decisions and alert updates."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.case import Case
from backend.models.response_plan import ResponsePlan

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_audit_plans.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_audit_plans.db"
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


def _make_plan(headers, status: str) -> int:
    me = client_ref.get("/api/v1/auth/me", headers=headers)
    uid = me.json()["id"]
    with _TestingSessionLocal() as db:
        case = Case(user_id=uid, title="Case", status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        plan = ResponsePlan(
            case_id=case.id, user_id=uid, actions=[],
            status=status, autonomy_level="L1",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan.id


def _audit_rows(action: str):
    with _TestingSessionLocal() as db:
        return list(db.execute(select(AuditLog).where(AuditLog.action == action)).scalars().all())


client_ref: TestClient = None  # set inside each test for the seed helpers


class TestResponsePlanAudit:
    def test_approve_writes_audit(self, client):
        global client_ref
        client_ref = client
        headers = _register_and_login(client, "approve@example.com")
        plan_id = _make_plan(headers, "pending_approval")

        with _TestingSessionLocal() as db:
            plan = db.get(ResponsePlan, plan_id)
            plan.actions = [{"action_type": "notify", "target": "soc"}]
            db.commit()
        review = client.get(f"/api/v1/response-plans/{plan_id}/approval-review", headers=headers).json()
        resp = client.post(f"/api/v1/response-plans/{plan_id}/approve", headers=headers,
                           json={"reviewed_fingerprint": review["review_fingerprint"]})
        assert resp.status_code == 200, resp.text

        rows = _audit_rows("response_plan_approved")
        assert any(r.target_type == "response_plan" and r.target_id == plan_id for r in rows)

    def test_reject_writes_audit(self, client):
        global client_ref
        client_ref = client
        headers = _register_and_login(client, "reject@example.com")
        plan_id = _make_plan(headers, "pending_approval")

        resp = client.post(
            f"/api/v1/response-plans/{plan_id}/reject",
            json={"reason": "Too broad"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        rows = _audit_rows("response_plan_rejected")
        assert any(r.target_id == plan_id and "Too broad" in (r.detail or "") for r in rows)

    def test_execute_writes_audit(self, client):
        global client_ref
        client_ref = client
        headers = _register_and_login(client, "execute@example.com")
        plan_id = _make_plan(headers, "approved")

        resp = client.post(f"/api/v1/response-plans/{plan_id}/execute", headers=headers)
        assert resp.status_code == 200, resp.text

        payload = resp.json()["data"]
        assert payload["execution_mode"] == "simulated"
        assert all(row["execution_mode"] == "simulated" for row in payload["results"])
        with _TestingSessionLocal() as db:
            saved = db.get(ResponsePlan, plan_id)
            assert all(action["execution_result"]["execution_mode"] == "simulated" for action in saved.actions)

        rows = _audit_rows("response_plan_executed")
        assert any(
            r.target_type == "response_plan" and r.target_id == plan_id and "simulated" in r.detail
            for r in rows
        )


class TestAlertUpdateAudit:
    def test_status_change_writes_audit(self, client):
        headers = _register_and_login(client, "alert@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        with _TestingSessionLocal() as db:
            asset = Asset(name="audit-host", asset_type="host", user_id=uid)
            db.add(asset)
            db.commit()
            db.refresh(asset)
            alert = Alert(
                title="Audit me", description="d", severity="high",
                asset_id=asset.id, user_id=uid,
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            alert_id = alert.id

        resp = client.patch(
            f"/api/v1/alerts/{alert_id}",
            json={"status": "acknowledged"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        rows = _audit_rows("alert_updated")
        assert any(
            r.target_type == "alert" and r.target_id == alert_id and "status" in (r.detail or "")
            for r in rows
        )
