"""Tests for security headers middleware."""

import pytest
from httpx import AsyncClient, ASGITransport
import os

os.environ["DISABLE_SCHEDULER"] = "1"

from backend.main import app


@pytest.mark.asyncio
async def test_health_endpoint_has_security_headers():
    """All responses should include security headers."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.headers.get("X-Content-Type-Options") == "nosniff"
        assert response.headers.get("X-Frame-Options") == "DENY"
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert "Strict-Transport-Security" in response.headers
        assert "Content-Security-Policy" in response.headers
        assert "Permissions-Policy" in response.headers


@pytest.mark.asyncio
async def test_security_headers_on_error_responses():
    """Security headers should be present even on 404 responses."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/nonexistent-path-12345")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"
        assert response.headers.get("X-Frame-Options") == "DENY"
