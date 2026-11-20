"""Tests for DELETE /api/v1/hunt/{session_id}."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.detection_rule import HuntSession
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_hunt_session_delete.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_hunt_session_delete.db"
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


def _seed_session(email: str, hypothesis: str) -> int:
    """Insert a hunt session owned by the given user and return its id."""
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        session = HuntSession(
            user_id=user.id,
            hypothesis=hypothesis,
            status="completed",
            queries_run=2,
            findings_count=3,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session.id


class TestHuntSessionDelete:
    def test_delete_own_session(self, client):
        headers = _register_and_login(client, "hunter@example.com")
        session_id = _seed_session("hunter@example.com", "DNS tunneling")
        res = client.delete(f"/api/v1/hunt/{session_id}", headers=headers)
        assert res.status_code == 204
        listing = client.get("/api/v1/hunt/", headers=headers)
        assert listing.status_code == 200
        assert all(s["id"] != session_id for s in listing.json())
        with _TestingSessionLocal() as db:
            assert db.get(HuntSession, session_id) is None

    def test_delete_missing_session_returns_404(self, client):
        headers = _register_and_login(client, "hunter2@example.com")
        res = client.delete("/api/v1/hunt/9999", headers=headers)
        assert res.status_code == 404

    def test_cannot_delete_another_users_session(self, client):
        _register_and_login(client, "owner@example.com")
        headers_b = _register_and_login(client, "intruder@example.com")
        session_id = _seed_session("owner@example.com", "Beaconing review")
        res = client.delete(f"/api/v1/hunt/{session_id}", headers=headers_b)
        assert res.status_code == 404
        with _TestingSessionLocal() as db:
            assert db.get(HuntSession, session_id) is not None

    def test_delete_requires_auth(self, client):
        _register_and_login(client, "hunter3@example.com")
        session_id = _seed_session("hunter3@example.com", "Lateral movement")
        client.cookies.clear()
        res = client.delete(f"/api/v1/hunt/{session_id}")
        assert res.status_code == 401
        with _TestingSessionLocal() as db:
            assert db.get(HuntSession, session_id) is not None

    def test_detection_rule_delete_still_routes(self, client):
        """The session delete route must not shadow DELETE /detections/{rule_id}."""
        headers = _register_and_login(client, "hunter4@example.com")
        create = client.post("/api/v1/hunt/detections", json={
            "name": "SSH brute force",
            "rule_type": "sigma",
            "rule_content": "title: ssh brute force\nstatus: experimental",
            "confidence": "medium",
        }, headers=headers)
        assert create.status_code == 200
        rule_id = create.json()["id"]
        res = client.delete(f"/api/v1/hunt/detections/{rule_id}", headers=headers)
        assert res.status_code == 204


def test_new_hunt_preserves_explanation_and_query_evidence_on_reopen(client, monkeypatch):
    from unittest.mock import AsyncMock
    from backend.services.agents.hunt import HuntAgent

    headers = _register_and_login(client, 'result-owner@example.com')
    result = {
        'explanation': 'Recorded explanation for this hypothesis',
        'query_results': [{'query': {'sql': 'SELECT host', 'description': 'Host evidence'},
                           'row_count': 1, 'rows': [{'host': 'plc-02'}]}],
        'sigma_rule': 'title: Recorded detection',
        'summary': 'Executed one query',
    }
    monkeypatch.setattr(HuntAgent, 'execute', AsyncMock(return_value=result))
    created = client.post('/api/v1/hunt/', headers=headers, json={'hypothesis': 'Review host evidence'})
    assert created.status_code == 200
    session_id = created.json()['data']['session_id']
    reopened = client.get(f'/api/v1/hunt/{session_id}', headers=headers)
    assert reopened.status_code == 200
    assert reopened.json()['result_data'] == result
    assert reopened.json()['queries_run'] == 1
    assert reopened.json()['findings_count'] == 1
    stranger = _register_and_login(client, 'other-hunter@example.com')
    assert client.get(f'/api/v1/hunt/{session_id}', headers=stranger).status_code == 404


def test_hunt_history_pages_all_owned_metadata_and_literal_search(client):
    from datetime import datetime

    headers = _register_and_login(client, 'history@example.com')
    _register_and_login(client, 'other-history@example.com')
    with _TestingSessionLocal() as db:
        uid = db.execute(select(User.id).where(User.email == 'history@example.com')).scalar_one()
        other_uid = db.execute(select(User.id).where(User.email == 'other-history@example.com')).scalar_one()
        db.add_all([HuntSession(user_id=uid, hypothesis=f'Hypothesis {i}', status='completed',
                                findings_count=1, created_at=datetime(2026, 1, 1),
                                result_data={'private_rows': [i]}) for i in range(65)])
        db.add(HuntSession(user_id=uid, hypothesis='Old 100%_literal retained', status='failed', findings_count=0, created_at=datetime(2020, 1, 1)))
        db.add(HuntSession(user_id=other_uid, hypothesis='Hidden foreign hypothesis', status='completed', findings_count=9))
        db.commit()
    seen = []
    for page in range(1, 5):
        response = client.get('/api/v1/hunt/history', params={'page': page}, headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['total'] == 66
        assert all('result_data' not in row for row in data['sessions'])
        seen.extend(row['id'] for row in data['sessions'])
    assert len(seen) == len(set(seen)) == 66
    assert len(client.get('/api/v1/hunt/', headers=headers).json()) == 50
    result = client.get('/api/v1/hunt/history', params={'search': '100%_LITERAL', 'state': 'failed'}, headers=headers).json()
    assert result['total'] == 1
    assert result['sessions'][0]['hypothesis'] == 'Old 100%_literal retained'
    assert client.get('/api/v1/hunt/history', params={'with_findings': True}, headers=headers).json()['total'] == 65
    assert client.get('/api/v1/hunt/history', params={'search': 'Hidden'}, headers=headers).json()['total'] == 0
    for params in ({'page': 0}, {'size': 101}, {'state': 'unknown'}, {'search': 'x' * 201}):
        assert client.get('/api/v1/hunt/history', params=params, headers=headers).status_code == 422
