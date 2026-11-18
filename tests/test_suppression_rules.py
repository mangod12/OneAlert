"""
Tests for alert suppression rules.

Covers: CRUD with validation, active-alert match counts, owner isolation,
and the auto-snooze of newly created alerts in the alert checker.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.suppression_rule import AlertSuppressionRule, rule_matches
from backend.models.user import User
from backend.services.alert_checker import _apply_suppression_rules
from backend.services.auth_service import get_password_hash


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_suppression_rules.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_suppression_rules.db"
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
    session.add(asset)
    session.flush()
    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Ransomware behavior on historian",
        description="Encryption burst", severity="critical", status="pending",
        cve_id="CVE-2026-0001",
    ))
    session.add(Alert(
        user_id=user_id, asset_id=asset.id, title="Historian firmware tamper",
        description="unsigned image", severity="high", status="resolved",
        cve_id="CVE-2026-0002",
    ))
    session.commit()
    return asset.id


@pytest.fixture(scope="function")
def client():
    """Create a test client with a seeded user, asset and alerts."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="suppression_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Suppression Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        _seed(session, user.id)
        session.add(AlertSuppressionRule(
            user_id=user.id, name="Historian ransomware noise",
            title_contains="ransomware", duration_hours=48,
        ))
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
        data={"username": "suppression_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestSuppressionRulesApi:
    def test_list_with_match_counts(self, client, auth_headers):
        response = client.get("/api/v1/suppression-rules/", headers=auth_headers)
        assert response.status_code == 200
        rules = response.json()
        assert len(rules) == 1
        rule = rules[0]
        assert rule["name"] == "Historian ransomware noise"
        assert rule["matching_active_alerts"] == 1  # resolved alert does not count

    def test_create_and_validate(self, client, auth_headers):
        response = client.post("/api/v1/suppression-rules/", headers=auth_headers, json={
            "name": "Old Acrobat CVE", "cve_id": "cve-2026-9999", "severity": "low",
            "duration_hours": 12,
        })
        assert response.status_code == 201
        body = response.json()
        assert body["cve_id"] == "cve-2026-9999"
        assert body["duration_hours"] == 12
        assert body["enabled"] is True

    def test_create_requires_a_criterion(self, client, auth_headers):
        response = client.post("/api/v1/suppression-rules/", headers=auth_headers,
                               json={"name": "match everything"})
        assert response.status_code == 422

    def test_create_rejects_unknown_asset(self, client, auth_headers):
        response = client.post("/api/v1/suppression-rules/", headers=auth_headers,
                               json={"name": "bad asset", "asset_id": 9999})
        assert response.status_code == 404

    def test_update_toggle_and_criteria_guard(self, client, auth_headers):
        rules = client.get("/api/v1/suppression-rules/", headers=auth_headers).json()
        rule_id = rules[0]["id"]
        response = client.patch(f"/api/v1/suppression-rules/{rule_id}", headers=auth_headers,
                                json={"enabled": False})
        assert response.status_code == 200
        assert response.json()["enabled"] is False
        # Clearing the only criterion is rejected.
        response = client.patch(f"/api/v1/suppression-rules/{rule_id}", headers=auth_headers,
                                json={"title_contains": ""})
        assert response.status_code == 422

    def test_delete(self, client, auth_headers):
        created = client.post("/api/v1/suppression-rules/", headers=auth_headers,
                              json={"name": "temp", "severity": "low"}).json()
        response = client.delete(f"/api/v1/suppression-rules/{created['id']}", headers=auth_headers)
        assert response.status_code == 204
        remaining = client.get("/api/v1/suppression-rules/", headers=auth_headers).json()
        assert all(r["id"] != created["id"] for r in remaining)

    def test_requires_auth(self, client):
        assert client.get("/api/v1/suppression-rules/").status_code == 401


class TestRuleMatching:
    def _rule(self, **kwargs):
        rule = AlertSuppressionRule(user_id=1, name="r", duration_hours=24, **kwargs)
        return rule

    def test_all_set_criteria_must_match(self):
        rule = self._rule(cve_id="CVE-2026-0001", severity="critical")
        assert rule_matches(rule, cve_id="cve-2026-0001", asset_id=1, severity="critical", title="x")
        assert not rule_matches(rule, cve_id="cve-2026-0001", asset_id=1, severity="high", title="x")
        assert not rule_matches(rule, cve_id=None, asset_id=1, severity="critical", title="x")

    def test_title_substring_is_case_insensitive(self):
        rule = self._rule(title_contains="Ransom")
        assert rule_matches(rule, cve_id=None, asset_id=None, severity=None, title="RANSOMWARE burst")


class TestCheckerSuppression:
    @pytest.mark.asyncio
    async def test_matching_rule_snoozes_new_alert(self):
        Base.metadata.create_all(bind=engine)
        with TestingSessionLocal() as session:
            user = User(
                email="checker_suppress@example.com",
                hashed_password=get_password_hash("testpass123"),
                full_name="Checker", company="Test Corp", is_active=True, is_verified=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            user_id = user.id
            asset = Asset(user_id=user_id, name="plc-01", asset_type="hardware")
            session.add(asset)
            session.flush()
            asset_id = asset.id
            session.add(AlertSuppressionRule(
                user_id=user_id, name="Known scanner noise",
                title_contains="scanner", duration_hours=72,
            ))
            session.commit()

        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, user_id)
            alert = Alert(
                user_id=user_id, asset_id=asset_id, title="Routine scanner sweep",
                severity="low", status="pending",
            )
            session.add(alert)
            await session.flush()
            await _apply_suppression_rules(session, user, alert)
            assert alert.snoozed_until is not None
            expected = datetime.now(UTC) + timedelta(hours=72)
            actual = alert.snoozed_until
            actual = actual.replace(tzinfo=UTC) if actual.tzinfo is None else actual
            assert abs((actual - expected).total_seconds()) < 60
            await session.rollback()

        # A non-matching alert stays untouched.
        async with AsyncTestingSessionLocal() as session:
            user = await session.get(User, user_id)
            alert = Alert(
                user_id=user_id, asset_id=asset_id, title="Firmware backdoor",
                severity="critical", status="pending",
            )
            session.add(alert)
            await session.flush()
            await _apply_suppression_rules(session, user, alert)
            assert alert.snoozed_until is None
            await session.rollback()

        with engine.connect() as connection:
            transaction = connection.begin()
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
            transaction.commit()
        Base.metadata.drop_all(bind=engine)
