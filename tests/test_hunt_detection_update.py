"""Tests for PATCH /api/v1/hunt/detections/{rule_id}."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_hunt_detection_update.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_hunt_detection_update.db"
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


def _create_rule(client: TestClient, headers, name="SSH brute force") -> int:
    res = client.post("/api/v1/hunt/detections", json={
        "name": name,
        "rule_type": "sigma",
        "rule_content": "title: ssh brute force\nstatus: experimental",
        "confidence": "medium",
    }, headers=headers)
    assert res.status_code == 200, f"Rule creation failed: {res.text}"
    return res.json()["id"]


class TestDetectionRuleUpdate:
    def test_disable_and_enable(self, client):
        headers = _register_and_login(client, "hunter@example.com")
        rule_id = _create_rule(client, headers)
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"enabled": False}, headers=headers)
        assert res.status_code == 200
        assert res.json()["enabled"] is False
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"enabled": True}, headers=headers)
        assert res.status_code == 200
        assert res.json()["enabled"] is True

    def test_rename_and_confidence(self, client):
        headers = _register_and_login(client, "hunter2@example.com")
        rule_id = _create_rule(client, headers)
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={
            "name": "  SSH password spraying  ",
            "description": "Tuned for VPN logs",
            "confidence": "high",
        }, headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["name"] == "SSH password spraying"
        assert body["description"] == "Tuned for VPN logs"
        assert body["confidence"] == "high"
        assert body["enabled"] is True

    def test_invalid_confidence_rejected(self, client):
        headers = _register_and_login(client, "hunter3@example.com")
        rule_id = _create_rule(client, headers)
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"confidence": "extreme"}, headers=headers)
        assert res.status_code == 422

    def test_empty_name_rejected(self, client):
        headers = _register_and_login(client, "hunter4@example.com")
        rule_id = _create_rule(client, headers)
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"name": "   "}, headers=headers)
        assert res.status_code == 400

    def test_other_users_rule_not_found(self, client):
        headers_a = _register_and_login(client, "hunter5@example.com")
        headers_b = _register_and_login(client, "hunter6@example.com")
        rule_id = _create_rule(client, headers_a)
        res = client.patch(f"/api/v1/hunt/detections/{rule_id}", json={"enabled": False}, headers=headers_b)
        assert res.status_code == 404

    def test_missing_rule_not_found(self, client):
        headers = _register_and_login(client, "hunter7@example.com")
        res = client.patch("/api/v1/hunt/detections/9999", json={"enabled": False}, headers=headers)
        assert res.status_code == 404


class TestDetectionRuleDelete:
    def test_delete_own_rule(self, client):
        headers = _register_and_login(client, "hunter8@example.com")
        rule_id = _create_rule(client, headers)
        res = client.delete(f"/api/v1/hunt/detections/{rule_id}", headers=headers)
        assert res.status_code == 204
        remaining = client.get("/api/v1/hunt/detections", headers=headers)
        assert all(rule["id"] != rule_id for rule in remaining.json())

    def test_delete_other_users_rule_not_found(self, client):
        headers_a = _register_and_login(client, "hunter9@example.com")
        headers_b = _register_and_login(client, "hunter10@example.com")
        rule_id = _create_rule(client, headers_a)
        res = client.delete(f"/api/v1/hunt/detections/{rule_id}", headers=headers_b)
        assert res.status_code == 404
        # Owner's rule is untouched.
        remaining = client.get("/api/v1/hunt/detections", headers=headers_a)
        assert any(rule["id"] == rule_id for rule in remaining.json())

    def test_delete_missing_rule_not_found(self, client):
        headers = _register_and_login(client, "hunter11@example.com")
        res = client.delete("/api/v1/hunt/detections/9999", headers=headers)
        assert res.status_code == 404


@pytest.mark.parametrize('enabled', [False, True])
def test_create_rule_preserves_explicit_enabled_state_without_test_confirmation(client, enabled):
    headers = _register_and_login(client, 'draft-review@example.com')
    response = client.post('/api/v1/hunt/detections', headers=headers, json={
        'name': 'Reviewed draft', 'rule_type': 'sigma', 'rule_content': 'title: Retained guard',
        'confidence': 'high', 'mitre_techniques': ['T1110'], 'enabled': enabled,
    })
    assert response.status_code == 200
    saved = response.json()
    assert saved['enabled'] is enabled
    assert saved['tested'] is False
    assert saved['mitre_techniques'] == ['T1110']
    records = client.get('/api/v1/hunt/detections', headers=headers).json()
    assert records == [saved]
