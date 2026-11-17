"""Regression tests: OAuth endpoint errors must not leak internal details."""

import pytest
from httpx import ASGITransport, AsyncClient

from backend.main import app
from backend.services.github_auth_service import github_auth_service


@pytest.mark.asyncio
async def test_github_login_failure_hides_internal_error(monkeypatch):
    def _boom(state):
        raise RuntimeError("client_secret=s3cr3t-value at /etc/internal/config")

    monkeypatch.setattr(github_auth_service, "get_authorization_url", _boom)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get("/api/v1/auth/github/login")

    assert response.status_code == 500
    detail = response.json()["error"]["message"]
    assert "s3cr3t" not in detail
    assert "/etc/internal" not in detail
    assert detail == "GitHub sign-in could not be started"


@pytest.mark.asyncio
async def test_github_login_misconfiguration_hides_value_error(monkeypatch):
    def _boom(state):
        raise ValueError("Missing GITHUB_CLIENT_SECRET=supersecret")

    monkeypatch.setattr(github_auth_service, "get_authorization_url", _boom)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get("/api/v1/auth/github/login")

    assert response.status_code == 500
    detail = response.json()["error"]["message"]
    assert "supersecret" not in detail
    assert detail == "GitHub sign-in is not configured correctly"


@pytest.mark.asyncio
async def test_github_callback_failure_hides_internal_error(monkeypatch):
    from backend.routers.auth import _pending_github_states, _store_github_state

    async def _boom(code, expected_state, received_state):
        raise RuntimeError("token endpoint password=hunter2")

    _pending_github_states.clear()
    _store_github_state("known-state")
    monkeypatch.setattr(github_auth_service, "authenticate_user", _boom)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get(
            "/api/v1/auth/github/callback", params={"code": "abc", "state": "known-state"}
        )

    assert response.status_code == 500
    detail = response.json()["error"]["message"]
    assert "hunter2" not in detail
    assert detail == "GitHub sign-in could not be completed"
