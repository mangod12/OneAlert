"""
Tests for multi-tenancy organization endpoints.

Covers organization creation, retrieval, update, invitation, member listing,
and cross-org data isolation.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base


# Use the same test.db as test_api.py to avoid cross-module override conflicts
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test.db"
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
    # Set overrides for this module
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db

    Base.metadata.create_all(bind=_engine)
    with TestClient(app) as test_client:
        yield test_client
    with _engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=_engine)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    """Register a user and return auth headers."""
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


# ---------------------------------------------------------------------------
# Organization CRUD
# ---------------------------------------------------------------------------

class TestOrganizationCreation:
    """Tests for POST /api/v1/orgs/"""

    def test_create_org(self, client):
        """Creating an org assigns creator as admin and returns org details."""
        headers = register_and_login(client, "admin@example.com")
        resp = client.post("/api/v1/orgs/", json={
            "name": "Acme Corp",
            "slug": "acme-corp",
            "plan": "starter",
        }, headers=headers)

        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Acme Corp"
        assert data["slug"] == "acme-corp"
        assert data["plan"] == "starter"
        assert data["max_assets"] == 50
        assert data["max_users"] == 3
        assert "id" in data
        assert "created_at" in data

    def test_create_org_default_plan(self, client):
        """Default plan should be 'free'."""
        headers = register_and_login(client, "admin@example.com")
        resp = client.post("/api/v1/orgs/", json={
            "name": "Free Org",
            "slug": "free-org",
        }, headers=headers)

        assert resp.status_code == 201
        assert resp.json()["plan"] == "free"

    def test_create_org_duplicate_slug(self, client):
        """Duplicate slug should return 409."""
        h1 = register_and_login(client, "admin1@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org A", "slug": "same-slug",
        }, headers=h1)

        h2 = register_and_login(client, "admin2@example.com")
        resp = client.post("/api/v1/orgs/", json={
            "name": "Org B", "slug": "same-slug",
        }, headers=h2)

        assert resp.status_code == 409

    def test_create_org_user_already_in_org(self, client):
        """User already in an org cannot create another."""
        headers = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org 1", "slug": "org-1",
        }, headers=headers)

        resp = client.post("/api/v1/orgs/", json={
            "name": "Org 2", "slug": "org-2",
        }, headers=headers)

        assert resp.status_code == 400
        body = resp.json()
        error_msg = body.get("detail") or body.get("error", {}).get("message", "")
        assert "already belongs" in error_msg


# ---------------------------------------------------------------------------
# Get / Update org
# ---------------------------------------------------------------------------

class TestOrganizationReadUpdate:
    """Tests for GET /me and PATCH /me."""

    def test_get_my_org(self, client):
        """User can retrieve their organization."""
        headers = register_and_login(client, "owner@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "My Org", "slug": "my-org",
        }, headers=headers)

        resp = client.get("/api/v1/orgs/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["slug"] == "my-org"

    def test_get_org_no_org(self, client):
        """User without org gets 404."""
        headers = register_and_login(client, "solo@example.com")
        resp = client.get("/api/v1/orgs/me", headers=headers)
        assert resp.status_code == 404

    def test_update_org_admin(self, client):
        """Admin can update org settings."""
        headers = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Old Name", "slug": "update-org",
        }, headers=headers)

        resp = client.patch("/api/v1/orgs/me", json={
            "name": "New Name", "max_assets": 200,
        }, headers=headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "New Name"
        assert data["max_assets"] == 200

    def test_update_org_non_admin_forbidden(self, client):
        """Non-admin member cannot update org."""
        admin_h = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org", "slug": "my-org", "plan": "pro",
        }, headers=admin_h)

        # Register a second user and invite them
        member_h = register_and_login(client, "member@example.com")
        client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "member@example.com"},
            headers=admin_h,
        )

        resp = client.patch("/api/v1/orgs/me", json={
            "name": "Hacked",
        }, headers=member_h)

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Invite & Members
# ---------------------------------------------------------------------------

class TestOrganizationMembers:
    """Tests for invite and member listing."""

    def test_invite_user(self, client):
        """Admin can invite an existing user to the org."""
        admin_h = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Team Org", "slug": "team-org",
        }, headers=admin_h)

        register_and_login(client, "newguy@example.com")

        resp = client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "newguy@example.com"},
            headers=admin_h,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

    def test_invite_nonexistent_user(self, client):
        """Inviting a user that does not exist returns 404."""
        admin_h = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org", "slug": "org-invite",
        }, headers=admin_h)

        resp = client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "ghost@example.com"},
            headers=admin_h,
        )
        assert resp.status_code == 404

    def test_invite_user_already_in_org(self, client):
        """Cannot invite a user who already belongs to an org."""
        h1 = register_and_login(client, "admin1@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org A", "slug": "org-a",
        }, headers=h1)

        h2 = register_and_login(client, "admin2@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org B", "slug": "org-b",
        }, headers=h2)

        resp = client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "admin2@example.com"},
            headers=h1,
        )
        assert resp.status_code == 400

    def test_list_members(self, client):
        """List org members returns all users in the org."""
        admin_h = register_and_login(client, "admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Members Org", "slug": "members-org",
        }, headers=admin_h)

        register_and_login(client, "alice@example.com")
        client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "alice@example.com"},
            headers=admin_h,
        )

        resp = client.get("/api/v1/orgs/me/members", headers=admin_h)
        assert resp.status_code == 200
        members = resp.json()
        emails = {m["email"] for m in members}
        assert "admin@example.com" in emails
        assert "alice@example.com" in emails
        assert len(members) == 2


# ---------------------------------------------------------------------------
# Cross-org data isolation
# ---------------------------------------------------------------------------

class TestCrossOrgIsolation:
    """Verify that org membership is isolated between organizations."""

    def test_org_members_isolated(self, client):
        """Members of org1 do not appear in org2's member list."""
        # Org 1
        h1 = register_and_login(client, "org1admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org One", "slug": "org-one",
        }, headers=h1)

        register_and_login(client, "org1member@example.com")
        client.post(
            "/api/v1/orgs/me/invite",
            params={"email": "org1member@example.com"},
            headers=h1,
        )

        # Org 2
        h2 = register_and_login(client, "org2admin@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Org Two", "slug": "org-two",
        }, headers=h2)

        # Org 1 members
        resp1 = client.get("/api/v1/orgs/me/members", headers=h1)
        emails1 = {m["email"] for m in resp1.json()}

        # Org 2 members
        resp2 = client.get("/api/v1/orgs/me/members", headers=h2)
        emails2 = {m["email"] for m in resp2.json()}

        # Org 1 should have 2 members, org 2 should have 1
        assert len(emails1) == 2
        assert len(emails2) == 1

        # No overlap
        assert emails1.isdisjoint(emails2)

    def test_user_cannot_see_other_org(self, client):
        """A user in org1 cannot see org2 via /me."""
        h1 = register_and_login(client, "alice@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Alice Org", "slug": "alice-org",
        }, headers=h1)

        h2 = register_and_login(client, "bob@example.com")
        client.post("/api/v1/orgs/", json={
            "name": "Bob Org", "slug": "bob-org",
        }, headers=h2)

        # Alice sees her own org
        resp = client.get("/api/v1/orgs/me", headers=h1)
        assert resp.json()["slug"] == "alice-org"

        # Bob sees his own org
        resp = client.get("/api/v1/orgs/me", headers=h2)
        assert resp.json()["slug"] == "bob-org"
