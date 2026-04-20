"""
Tests for billing and subscription management endpoints.

Covers plan listing, subscription retrieval, checkout without Stripe,
usage reporting, plan limit checks, and subscription cancellation.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.subscription import Subscription
from backend.services.billing_service import (
    get_plan_info,
    check_feature_access,
    check_asset_limit,
    check_user_limit,
    PLAN_PRICES,
)


# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_billing.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_billing.db"
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


def create_org(client: TestClient, headers: dict, slug: str = "test-org"):
    """Create an organization for the logged-in user."""
    resp = client.post("/api/v1/orgs/", json={
        "name": "Test Org",
        "slug": slug,
        "plan": "starter",
    }, headers=headers)
    assert resp.status_code == 201, f"Org creation failed: {resp.text}"
    return resp.json()


# ---------------------------------------------------------------------------
# Plan listing
# ---------------------------------------------------------------------------

class TestPlanListing:
    """Tests for GET /api/v1/billing/plans."""

    def test_list_plans_returns_all_four(self, client):
        """List plans returns all 4 plans with correct pricing."""
        resp = client.get("/api/v1/billing/plans")
        assert resp.status_code == 200
        plans = resp.json()
        assert len(plans) == 4

        plan_names = [p["plan"] for p in plans]
        assert "free" in plan_names
        assert "starter" in plan_names
        assert "pro" in plan_names
        assert "enterprise" in plan_names

    def test_list_plans_correct_pricing(self, client):
        """Each plan has the correct monthly price."""
        resp = client.get("/api/v1/billing/plans")
        plans = {p["plan"]: p for p in resp.json()}

        assert plans["free"]["price_monthly"] == 0
        assert plans["starter"]["price_monthly"] == 49900
        assert plans["pro"]["price_monthly"] == 199900
        assert plans["enterprise"]["price_monthly"] == 499900

    def test_list_plans_includes_limits(self, client):
        """Plans include asset and user limits."""
        resp = client.get("/api/v1/billing/plans")
        plans = {p["plan"]: p for p in resp.json()}

        assert plans["free"]["max_assets"] == 10
        assert plans["free"]["max_users"] == 1
        assert plans["pro"]["max_assets"] == 500
        assert plans["enterprise"]["max_users"] == 99999


# ---------------------------------------------------------------------------
# Subscription retrieval
# ---------------------------------------------------------------------------

class TestSubscription:
    """Tests for GET /api/v1/billing/subscription."""

    def test_get_subscription_no_org_returns_404(self, client):
        """User without org gets 404."""
        headers = register_and_login(client, "noorg@example.com")
        resp = client.get("/api/v1/billing/subscription", headers=headers)
        assert resp.status_code == 404

    def test_get_subscription_with_org_returns_default(self, client):
        """User with org but no subscription record gets free plan defaults."""
        headers = register_and_login(client, "admin@example.com")
        create_org(client, headers)

        resp = client.get("/api/v1/billing/subscription", headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["plan"] == "free"
        assert data["status"] == "active"
        assert data["cancel_at_period_end"] is False


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------

class TestCheckout:
    """Tests for POST /api/v1/billing/checkout."""

    def test_checkout_without_stripe_key_returns_mock(self, client):
        """Checkout without Stripe key returns a mock response."""
        headers = register_and_login(client, "admin@example.com")
        create_org(client, headers)

        resp = client.post("/api/v1/billing/checkout", json={
            "plan": "pro",
        }, headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["checkout_url"] is None
        assert "not configured" in data["message"].lower() or "Stripe" in data["message"]
        assert data["plan"] == "pro"
        assert data["price"] == 199900

    def test_checkout_invalid_plan_returns_400(self, client):
        """Checkout with invalid plan returns 400."""
        headers = register_and_login(client, "admin@example.com")
        create_org(client, headers)

        resp = client.post("/api/v1/billing/checkout", json={
            "plan": "invalid_plan",
        }, headers=headers)
        assert resp.status_code == 400

    def test_checkout_no_org_returns_404(self, client):
        """Checkout without org returns 404."""
        headers = register_and_login(client, "noorg@example.com")
        resp = client.post("/api/v1/billing/checkout", json={
            "plan": "starter",
        }, headers=headers)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

class TestUsage:
    """Tests for GET /api/v1/billing/usage."""

    def test_usage_returns_counts_vs_limits(self, client):
        """Usage endpoint returns asset/user counts vs plan limits."""
        headers = register_and_login(client, "admin@example.com")
        create_org(client, headers)

        resp = client.get("/api/v1/billing/usage", headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["plan"] == "starter"
        assert "assets" in data
        assert "users" in data
        assert data["assets"]["current"] >= 0
        assert data["assets"]["limit"] == 100  # starter plan
        assert data["users"]["current"] >= 1  # at least the admin
        assert data["users"]["limit"] == 5  # starter plan
        assert "features" in data

    def test_usage_no_org_returns_404(self, client):
        """Usage without org returns 404."""
        headers = register_and_login(client, "noorg@example.com")
        resp = client.get("/api/v1/billing/usage", headers=headers)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Plan limit checks (service layer)
# ---------------------------------------------------------------------------

class TestPlanLimitChecks:
    """Tests for billing service plan limit functions."""

    def test_get_plan_info_valid(self):
        """get_plan_info returns correct data for valid plan."""
        info = get_plan_info("pro")
        assert info is not None
        assert info["plan"] == "pro"
        assert info["max_assets"] == 500
        assert info["max_users"] == 20
        assert "compliance" in info["features"]
        assert info["price_monthly"] == 199900

    def test_get_plan_info_invalid(self):
        """get_plan_info returns None for invalid plan."""
        info = get_plan_info("nonexistent")
        assert info is None

    def test_check_feature_access_allowed(self):
        """Feature access check returns True for allowed features."""
        assert check_feature_access("pro", "compliance") is True
        assert check_feature_access("enterprise", "anything") is True
        assert check_feature_access("free", "basic_alerts") is True

    def test_check_feature_access_denied(self):
        """Feature access check returns False for denied features."""
        assert check_feature_access("free", "compliance") is False
        assert check_feature_access("starter", "sbom") is False

    def test_check_asset_limit_within(self):
        """Asset limit check returns True when under limit."""
        assert check_asset_limit("free", 5) is True
        assert check_asset_limit("starter", 99) is True

    def test_check_asset_limit_exceeded(self):
        """Asset limit check returns False when at or over limit."""
        assert check_asset_limit("free", 10) is False
        assert check_asset_limit("free", 15) is False

    def test_check_user_limit_within(self):
        """User limit check returns True when under limit."""
        assert check_user_limit("starter", 4) is True
        assert check_user_limit("pro", 19) is True

    def test_check_user_limit_exceeded(self):
        """User limit check returns False when at or over limit."""
        assert check_user_limit("free", 1) is False
        assert check_user_limit("starter", 5) is False


# ---------------------------------------------------------------------------
# Cancel subscription
# ---------------------------------------------------------------------------

class TestCancelSubscription:
    """Tests for POST /api/v1/billing/cancel."""

    def test_cancel_subscription_no_org(self, client):
        """Cancel without org returns 404."""
        headers = register_and_login(client, "noorg@example.com")
        resp = client.post("/api/v1/billing/cancel", headers=headers)
        assert resp.status_code == 404

    def test_cancel_subscription_no_active_sub(self, client):
        """Cancel without subscription record returns 404."""
        headers = register_and_login(client, "admin@example.com")
        create_org(client, headers)

        resp = client.post("/api/v1/billing/cancel", headers=headers)
        assert resp.status_code == 404

    def test_cancel_subscription_updates_flag(self, client):
        """Cancel sets cancel_at_period_end to True."""
        headers = register_and_login(client, "admin@example.com")
        org_data = create_org(client, headers)

        # Manually insert a subscription record
        with _TestingSessionLocal() as db:
            sub = Subscription(
                org_id=org_data["id"],
                plan="pro",
                status="active",
                stripe_subscription_id="sub_test_123",
                cancel_at_period_end=False,
            )
            db.add(sub)
            db.commit()

        resp = client.post("/api/v1/billing/cancel", headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["cancel_at_period_end"] is True
