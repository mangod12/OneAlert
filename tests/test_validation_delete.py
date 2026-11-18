"""
Tests for deleting purple-team validation runs.

Covers: owner delete removes the run with its steps and control results,
unknown ids return 404, and another user's run cannot be deleted.
"""

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
