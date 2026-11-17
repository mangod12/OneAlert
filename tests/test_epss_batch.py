"""Tests for the batch EPSS lookup endpoint GET /api/v1/alerts/epss-batch."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_epss_batch.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_epss_batch.db"
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


@pytest.fixture
def client():
    """Create a test client with fresh database tables."""
    Base.metadata.create_all(bind=_engine)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _register_and_login(client: TestClient, email: str = "analyst@example.com", password: str = "securepass123"):
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _mock_epss_response(payload: dict):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload
    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


class TestEpssBatch:
    def test_returns_scores_for_requested_cves(self, client):
        headers = _register_and_login(client)
        mock_client = _mock_epss_response({
            "status": "OK",
            "data": [
                {"cve": "CVE-2024-1111", "epss": "0.91", "percentile": "0.99"},
                {"cve": "CVE-2024-2222", "epss": "0.04", "percentile": "0.31"},
            ],
        })
        with patch("backend.services.epss_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/epss-batch",
                params={"cve_ids": "CVE-2024-1111,CVE-2024-2222"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        scores = resp.json()["scores"]
        assert scores["CVE-2024-1111"]["score"] == 0.91
        assert scores["CVE-2024-1111"]["percentile"] == 0.99
        assert scores["CVE-2024-2222"]["score"] == 0.04

    def test_single_upstream_call_with_deduped_cves(self, client):
        headers = _register_and_login(client)
        mock_client = _mock_epss_response({"status": "OK", "data": []})
        with patch("backend.services.epss_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/epss-batch",
                params={"cve_ids": "CVE-2024-1111, CVE-2024-1111 ,CVE-2024-2222"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        call_kwargs = mock_client.get.call_args
        assert call_kwargs.kwargs["params"]["cve"] == "CVE-2024-1111,CVE-2024-2222"

    def test_empty_param_rejected(self, client):
        headers = _register_and_login(client)
        resp = client.get("/api/v1/alerts/epss-batch", params={"cve_ids": " , "}, headers=headers)
        assert resp.status_code == 422

    def test_over_100_cves_rejected(self, client):
        headers = _register_and_login(client)
        many = ",".join(f"CVE-2024-{10000 + i}" for i in range(101))
        resp = client.get("/api/v1/alerts/epss-batch", params={"cve_ids": many}, headers=headers)
        assert resp.status_code == 422

    def test_upstream_failure_returns_empty_scores(self, client):
        import httpx
        headers = _register_and_login(client)
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.ConnectError("boom")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        with patch("backend.services.epss_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/epss-batch",
                params={"cve_ids": "CVE-2024-1111"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["scores"] == {}

    def test_requires_auth(self, client):
        resp = client.get("/api/v1/alerts/epss-batch", params={"cve_ids": "CVE-2024-1111"})
        assert resp.status_code == 401
