"""Owner-scoped inspection of recorded agent runs and their steps."""
import asyncio
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.case import AgentRun, AgentStep
from backend.models.user import User
from backend.routers.auth import get_current_user


@pytest.fixture
def ledger(tmp_path):
    path = tmp_path / "agent_ledger.db"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    async_engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    sessions = sessionmaker(engine, expire_on_commit=False)
    async_sessions = async_sessionmaker(async_engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as db:
        owner = User(email="owner@ledger.test", hashed_password="unused", is_active=True)
        other = User(email="other@ledger.test", hashed_password="unused", is_active=True)
        db.add_all([owner, other])
        db.commit()
        run = AgentRun(user_id=owner.id, agent_type="triage", status="failed",
                       started_at=datetime.now(UTC), prompt_tokens=20, completion_tokens=5,
                       error_message="Recorded failure", result_summary="Partial result")
        db.add(run)
        db.flush()
        db.add_all([
            AgentStep(run_id=run.id, step_number=2, action="correlate", output_summary="One cluster"),
            AgentStep(run_id=run.id, step_number=1, action="analyze", input_summary="Three alerts",
                      tool_used="local_detector", duration_ms=25),
        ])
        db.commit()
        run_id = run.id

    async def current_user():
        return owner

    async def database():
        async with async_sessions() as db:
            yield db

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_async_db] = database
    client = TestClient(app)
    yield client, owner, other, run_id, sessions
    client.close()
    app.dependency_overrides.clear()
    asyncio.run(async_engine.dispose())
    engine.dispose()


def test_run_detail_returns_ordered_steps_and_recorded_failure(ledger):
    client, _owner, _, run_id, _ = ledger
    response = client.get(f"/api/v1/cases/agents/runs/{run_id}")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["id"] == run_id
    assert data["error_message"] == "Recorded failure"
    assert data["result_summary"] == "Partial result"
    assert data["prompt_tokens"] == 20
    assert [step["step_number"] for step in data["steps"]] == [1, 2]
    assert data["steps"][0]["input_summary"] == "Three alerts"
    assert data["steps"][0]["duration_ms"] == 25
    assert data["steps"][0]["tool_used"] == "local_detector"
    assert data["steps"][1]["output_summary"] == "One cluster"
    assert "user_id" not in data


def test_other_users_run_is_indistinguishable_from_missing(ledger):
    client, _, other, run_id, _ = ledger
    other.role = "admin"

    async def current_user():
        return other

    app.dependency_overrides[get_current_user] = current_user
    hidden = client.get(f"/api/v1/cases/agents/runs/{run_id}")
    missing = client.get("/api/v1/cases/agents/runs/999999")
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["error"] == missing.json()["error"] == {
        "code": "HTTP_404", "message": "Agent run not found",
    }


def test_empty_running_run_and_list_shape_are_preserved(ledger):
    client, owner, _, _, sessions = ledger
    with sessions() as db:
        run = AgentRun(user_id=owner.id, agent_type="hunt", status="running")
        db.add(run)
        db.commit()
        run_id = run.id
    detail = client.get(f"/api/v1/cases/agents/runs/{run_id}").json()
    assert detail["steps"] == []
    assert detail["error_message"] is None
    assert detail["completed_at"] is None
    listed = client.get("/api/v1/cases/agents/runs")
    assert listed.status_code == 200
    assert len(listed.json()) == 2
    assert all("steps" not in item and "error_message" not in item for item in listed.json())


def test_authentication_and_active_user_are_required(ledger):
    client, owner, _, run_id, _ = ledger
    owner.is_active = False
    assert client.get(f"/api/v1/cases/agents/runs/{run_id}").status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get(f"/api/v1/cases/agents/runs/{run_id}").status_code == 401
