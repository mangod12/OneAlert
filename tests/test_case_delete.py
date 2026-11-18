"""Tests for DELETE /api/v1/cases/{case_id}."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert, CaseTimeline
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_delete.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_delete.db"
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
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed_case(email: str) -> int:
    """Seed a case with a timeline note, an alert link and a response plan."""
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        asset = Asset(user_id=user.id, name="scada-historian", asset_type="server")
        db.add(asset)
        db.flush()
        alert = Alert(
            user_id=user.id,
            asset_id=asset.id,
            cve_id="CVE-2026-0001",
            title="Suspicious lateral movement",
            severity="high",
        )
        db.add(alert)
        case = Case(user_id=user.id, title="Lateral movement investigation", severity="high", status="open")
        db.add(case)
        db.flush()
        db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
        db.add(CaseTimeline(case_id=case.id, entry_type="note", content="Initial triage note", source="human"))
        plan = ResponsePlan(case_id=case.id, user_id=user.id, actions=[{"type": "isolate"}], status="draft")
        db.add(plan)
        db.flush()
        db.add(ApprovalRequest(plan_id=plan.id, status="pending"))
        db.commit()
        return case.id


class TestCaseDelete:
    def test_delete_removes_case_and_children(self, client):
        headers = _register_and_login(client, "analyst@example.com")
        case_id = _seed_case("analyst@example.com")
        res = client.delete(f"/api/v1/cases/{case_id}", headers=headers)
        assert res.status_code == 204
        assert client.get(f"/api/v1/cases/{case_id}", headers=headers).status_code == 404
        with _TestingSessionLocal() as db:
            assert db.get(Case, case_id) is None
            assert db.execute(select(CaseAlert).where(CaseAlert.case_id == case_id)).scalars().all() == []
            assert db.execute(select(CaseTimeline).where(CaseTimeline.case_id == case_id)).scalars().all() == []
            assert db.execute(select(ResponsePlan).where(ResponsePlan.case_id == case_id)).scalars().all() == []
            assert db.execute(select(ApprovalRequest)).scalars().all() == []
            # The linked alert itself is kept.
            assert db.execute(select(Alert)).scalars().one_or_none() is not None

    def test_delete_missing_case_returns_404(self, client):
        headers = _register_and_login(client, "analyst2@example.com")
        assert client.delete("/api/v1/cases/9999", headers=headers).status_code == 404

    def test_cannot_delete_another_users_case(self, client):
        _register_and_login(client, "owner@example.com")
        case_id = _seed_case("owner@example.com")
        headers_b = _register_and_login(client, "peer@example.com")
        assert client.delete(f"/api/v1/cases/{case_id}", headers=headers_b).status_code == 404
        with _TestingSessionLocal() as db:
            assert db.get(Case, case_id) is not None

    def test_delete_requires_auth(self, client):
        _register_and_login(client, "analyst3@example.com")
        case_id = _seed_case("analyst3@example.com")
        client.cookies.clear()
        assert client.delete(f"/api/v1/cases/{case_id}").status_code == 401
        with _TestingSessionLocal() as db:
            assert db.get(Case, case_id) is not None
