"""
Tests for the global search endpoint powering the command palette.

Covers: grouped results across alerts/cases/assets, substring matching
on each group's fields, per-group limits, owner isolation, and query
validation.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.user import User
from backend.services.auth_service import get_password_hash


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_search.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_search.db"
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


def _seed(session, user_id):
    asset = Asset(
        user_id=user_id, name="plant-historian", asset_type="historian",
        vendor="Acme", product="DataVault",
    )
    other_asset = Asset(
        user_id=user_id, name="edge-router", asset_type="hardware",
        vendor="NetCo", product="EdgeOS",
    )
    session.add_all([asset, other_asset])
    session.flush()

    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Ransomware behavior on historian",
        description="Encryption burst", severity="critical", status="pending",
    ))
    for i in range(6):
        session.add(Alert(
            user_id=user_id, asset_id=other_asset.id, title=f"Ransomware canary {i}",
            description="tripwire", severity="low", status="pending",
        ))
    session.add(Case(
        user_id=user_id, title="Ransomware outbreak investigation",
        summary="Plant floor impact", severity="high", status="open",
    ))
    session.commit()


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user and searchable records."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="search_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Search Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        _seed(session, user.id)

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
        data={"username": "search_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestGlobalSearch:
    """Test grouped global search results."""

    def test_matches_across_all_groups(self, client, auth_headers):
        response = client.get("/api/v1/search/", params={"q": "ransomware"},
                              headers=auth_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["query"] == "ransomware"
        assert len(data["alerts"]) == 5  # 7 matches, capped at the group limit
        assert len(data["cases"]) == 1
        assert data["cases"][0]["title"] == "Ransomware outbreak investigation"
        assert all("severity" in a and "status" in a for a in data["alerts"])

    def test_matches_assets_by_vendor(self, client, auth_headers):
        response = client.get("/api/v1/search/", params={"q": "acme"},
                              headers=auth_headers)
        data = response.json()["data"]
        assert [a["name"] for a in data["assets"]] == ["plant-historian"]
        assert data["assets"][0]["asset_type"] == "historian"

    def test_no_match_returns_empty_groups(self, client, auth_headers):
        response = client.get("/api/v1/search/", params={"q": "zzzz-nothing"},
                              headers=auth_headers)
        data = response.json()["data"]
        assert data["alerts"] == []
        assert data["cases"] == []
        assert data["assets"] == []

    def test_short_query_rejected(self, client, auth_headers):
        response = client.get("/api/v1/search/", params={"q": "a"},
                              headers=auth_headers)
        assert response.status_code == 422

    def test_other_users_records_are_hidden(self, client, auth_headers):
        client.post(
            "/api/v1/auth/register",
            json={
                "email": "other_search@example.com",
                "password": "otherpass123",
                "full_name": "Other User",
                "company": "Other Corp",
            },
        )
        login_resp = client.post(
            "/api/v1/auth/login",
            data={"username": "other_search@example.com", "password": "otherpass123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        response = client.get("/api/v1/search/", params={"q": "ransomware"},
                              headers=other_headers)
        data = response.json()["data"]
        assert data["alerts"] == []
        assert data["cases"] == []

    def test_unauthenticated_rejected(self, client):
        response = client.get("/api/v1/search/", params={"q": "ransomware"})
        assert response.status_code in (401, 403)
