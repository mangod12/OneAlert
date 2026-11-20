"""
Tests for deleting purple-team validation runs.

Covers: owner delete removes the run with its steps and control results,
unknown ids return 404, and another user's run cannot be deleted.
"""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.user import User
from backend.services.auth_service import get_password_hash


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_validation_delete.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_validation_delete.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="validation_delete@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Validation Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()

    with TestClient(app) as test_client:
        yield test_client

    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    """Get auth headers for the test user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "validation_delete@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_run(client, auth_headers, name="Weekly coverage test"):
    response = client.post(
        "/api/v1/validation/runs",
        json={"name": name, "mode": "dry_run", "mitre_techniques": ["T1110"]},
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()["data"]["id"]


class TestDeleteValidationRun:
    """Test deleting a validation run."""

    def test_delete_run_removes_it_and_its_steps(self, client, auth_headers):
        """An executed run disappears from the list with its steps after delete."""
        run_id = _create_run(client, auth_headers)

        execute = client.post(
            f"/api/v1/validation/runs/{run_id}/execute", headers=auth_headers
        )
        assert execute.status_code == 200
        detail = client.get(f"/api/v1/validation/runs/{run_id}", headers=auth_headers)
        assert len(detail.json()["data"]["steps"]) > 0

        response = client.delete(
            f"/api/v1/validation/runs/{run_id}", headers=auth_headers
        )
        assert response.status_code == 204

        detail = client.get(f"/api/v1/validation/runs/{run_id}", headers=auth_headers)
        assert detail.status_code == 404

        listing = client.get("/api/v1/validation/runs", headers=auth_headers)
        assert all(r["id"] != run_id for r in listing.json()["data"])

    def test_delete_pending_run(self, client, auth_headers):
        """A run that was never executed can be deleted."""
        run_id = _create_run(client, auth_headers)
        response = client.delete(
            f"/api/v1/validation/runs/{run_id}", headers=auth_headers
        )
        assert response.status_code == 204

    def test_delete_unknown_run_returns_404(self, client, auth_headers):
        response = client.delete(
            "/api/v1/validation/runs/999999", headers=auth_headers
        )
        assert response.status_code == 404

    def test_cannot_delete_other_users_run(self, client, auth_headers):
        run_id = _create_run(client, auth_headers)

        client.post(
            "/api/v1/auth/register",
            json={
                "email": "other_validation@example.com",
                "password": "otherpass123",
                "full_name": "Other User",
                "company": "Other Corp",
            },
        )
        login_resp = client.post(
            "/api/v1/auth/login",
            data={"username": "other_validation@example.com", "password": "otherpass123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        response = client.delete(
            f"/api/v1/validation/runs/{run_id}", headers=other_headers
        )
        assert response.status_code == 404

        detail = client.get(f"/api/v1/validation/runs/{run_id}", headers=auth_headers)
        assert detail.status_code == 200


class TestExportValidationRun:
    """Test exporting a validation run's results as CSV."""

    def test_export_contains_steps_and_controls(self, client, auth_headers):
        run_id = _create_run(client, auth_headers)
        execute = client.post(
            f"/api/v1/validation/runs/{run_id}/execute", headers=auth_headers
        )
        assert execute.status_code == 200

        response = client.get(
            f"/api/v1/validation/runs/{run_id}/export", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert f"validation-run-{run_id}.csv" in response.headers["content-disposition"]

        rows = list(csv.reader(io.StringIO(response.text)))
        assert rows[0] == [
            "run", "mode", "run_status", "step_number", "technique_id",
            "technique_name", "test_name", "test_type", "step_status",
            "actual_result", "duration_ms", "controls", "executed_at",
        ]
        assert len(rows) > 1
        assert rows[1][0] == "Weekly coverage test"
        assert rows[1][1] == "dry_run"
        assert rows[1][4] == "T1110"

    def test_export_unknown_run_returns_404(self, client, auth_headers):
        response = client.get(
            "/api/v1/validation/runs/999999/export", headers=auth_headers
        )
        assert response.status_code == 404

    def test_export_other_users_run_returns_404(self, client, auth_headers):
        run_id = _create_run(client, auth_headers)
        client.post(
            "/api/v1/auth/register",
            json={
                "email": "other_export@example.com",
                "password": "otherpass123",
                "full_name": "Other User",
                "company": "Other Corp",
            },
        )
        login_resp = client.post(
            "/api/v1/auth/login",
            data={"username": "other_export@example.com", "password": "otherpass123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}
        response = client.get(
            f"/api/v1/validation/runs/{run_id}/export", headers=other_headers
        )
        assert response.status_code == 404


@pytest.mark.parametrize("export", [False, True])
def test_validation_controls_loaded_in_one_scoped_query(client, auth_headers, monkeypatch, export):
    """Many-step detail/export needs one control read, with correct step grouping."""
    from backend.models.validation import ControlResult, ValidationRun, ValidationStep

    run_id = _create_run(client, auth_headers)
    with TestingSessionLocal() as session:
        owner_id = session.get(ValidationRun, run_id).user_id
        other_run = ValidationRun(user_id=owner_id, name="Separate run", mode="dry_run")
        session.add(other_run)
        session.flush()
        for index in range(31):
            step = ValidationStep(
                run_id=run_id if index < 30 else other_run.id,
                step_number=index + 1, technique_id="T1110", technique_name="Brute force",
                test_name=f"Step {index}", test_type="manual", status="completed", simulated=True,
            )
            session.add(step)
            session.flush()
            if index != 0:
                for suffix in ["a", "b"]:
                    session.add(ControlResult(
                        step_id=step.id, control_name=f"Control {index}{suffix}",
                        control_type="manual", expected=True, detected=False,
                    ))
        session.commit()

    reads = []
    original_execute = AsyncSession.execute

    async def counted_execute(self, statement, *args, **kwargs):
        if "FROM control_results" in str(statement):
            reads.append(str(statement))
        return await original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "execute", counted_execute)
    response = client.get(
        f"/api/v1/validation/runs/{run_id}" + ("/export" if export else ""), headers=auth_headers,
    )
    assert response.status_code == 200
    assert len(reads) == 1
    assert "Control 30" not in response.text
    if export:
        rows = list(csv.reader(io.StringIO(response.text)))
        assert len(rows) == 31
        assert rows[1][11] == ""
        assert rows[2][11] == "Control 1a (missed); Control 1b (missed)"
    else:
        steps = response.json()["data"]["steps"]
        assert len(steps) == 30
        assert steps[0]["controls"] == []
        assert [c["control_name"] for c in steps[1]["controls"]] == ["Control 1a", "Control 1b"]


@pytest.mark.parametrize("export", [False, True])
def test_empty_validation_run_needs_no_control_query(client, auth_headers, monkeypatch, export):
    run_id = _create_run(client, auth_headers)
    original_execute = AsyncSession.execute

    async def no_control_read(self, statement, *args, **kwargs):
        assert "FROM control_results" not in str(statement)
        return await original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "execute", no_control_read)
    response = client.get(
        f"/api/v1/validation/runs/{run_id}" + ("/export" if export else ""), headers=auth_headers,
    )
    assert response.status_code == 200
