"""Tests for standardized API error responses."""

import pytest
from httpx import AsyncClient, ASGITransport
import os

os.environ["DISABLE_SCHEDULER"] = "1"
os.environ["TESTING"] = "1"

from backend.main import app


@pytest.mark.asyncio
async def test_responses_include_request_id_header():
    """All responses should include X-Request-ID header."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert "X-Request-ID" in response.headers
        request_id = response.headers["X-Request-ID"]
        assert len(request_id) == 36  # UUID length


@pytest.mark.asyncio
async def test_custom_request_id_is_preserved():
    """If client sends X-Request-ID, it should be preserved."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        custom_id = "custom-trace-id-12345"
        response = await client.get("/health", headers={"X-Request-ID": custom_id})
        assert response.headers["X-Request-ID"] == custom_id


@pytest.mark.asyncio
async def test_error_response_has_envelope_format():
    """Error responses should follow the standardized envelope."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/assets/99999",
                                    headers={"Authorization": "Bearer invalid"})
        body = response.json()
        assert body["success"] is False
        assert body["data"] is None
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]
        assert "metadata" in body
        assert "request_id" in body["metadata"]
