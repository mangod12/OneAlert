"""Tests for the batch CISA KEV lookup endpoint GET /api/v1/alerts/kev-batch."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.services import kev_service

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_kev_batch.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_kev_batch.db"
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


@pytest.fixture(autouse=True)
def _reset_kev_cache():
    kev_service._reset_cache()
    yield
    kev_service._reset_cache()


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


def _register_and_login(client: TestClient, email: str = "analyst@example.com"):
    password = "securepass123"
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _mock_kev_response(payload: dict):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload
    mock_client = AsyncMock()
    mock_client.get.return_value = mock_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client


_CATALOG = {
    "vulnerabilities": [
        {"cveID": "CVE-2024-1111", "dateAdded": "2024-05-01", "dueDate": "2024-05-22",
         "knownRansomwareCampaignUse": "Known", "requiredAction": "Apply updates."},
        {"cveID": "CVE-2024-2222", "dateAdded": "2024-06-01", "dueDate": "2024-06-21",
         "knownRansomwareCampaignUse": "Unknown", "requiredAction": "Patch."},
    ],
}


class TestKevBatch:
    def test_returns_entries_for_catalogued_cves_only(self, client):
        headers = _register_and_login(client)
        mock_client = _mock_kev_response(_CATALOG)
        with patch("backend.services.kev_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/kev-batch",
                params={"cve_ids": "CVE-2024-1111,CVE-2024-9999"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        entries = resp.json()["entries"]
        assert set(entries) == {"CVE-2024-1111"}
        assert entries["CVE-2024-1111"]["date_added"] == "2024-05-01"
        assert entries["CVE-2024-1111"]["known_ransomware_campaign_use"] == "Known"

    def test_case_insensitive_lookup(self, client):
        headers = _register_and_login(client)
        mock_client = _mock_kev_response(_CATALOG)
        with patch("backend.services.kev_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/kev-batch",
                params={"cve_ids": "cve-2024-2222"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["entries"]["cve-2024-2222"]["due_date"] == "2024-06-21"

    def test_catalog_cached_across_requests(self, client):
        headers = _register_and_login(client)
        mock_client = _mock_kev_response(_CATALOG)
        with patch("backend.services.kev_service.httpx.AsyncClient", return_value=mock_client):
            for _ in range(2):
                resp = client.get(
                    "/api/v1/alerts/kev-batch",
                    params={"cve_ids": "CVE-2024-1111"},
                    headers=headers,
                )
                assert resp.status_code == 200
        assert mock_client.get.call_count == 1

    def test_upstream_failure_returns_empty_entries(self, client):
        headers = _register_and_login(client)
        mock_client = AsyncMock()
        import httpx
        mock_client.get.side_effect = httpx.HTTPError("boom")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        with patch("backend.services.kev_service.httpx.AsyncClient", return_value=mock_client):
            resp = client.get(
                "/api/v1/alerts/kev-batch",
                params={"cve_ids": "CVE-2024-1111"},
                headers=headers,
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["entries"] == {}

    def test_blank_ids_rejected(self, client):
        headers = _register_and_login(client)
        resp = client.get("/api/v1/alerts/kev-batch", params={"cve_ids": " , "}, headers=headers)
        assert resp.status_code == 422

    def test_over_100_ids_rejected(self, client):
        headers = _register_and_login(client)
        ids = ",".join(f"CVE-2024-{i:04d}" for i in range(101))
        resp = client.get("/api/v1/alerts/kev-batch", params={"cve_ids": ids}, headers=headers)
        assert resp.status_code == 422
