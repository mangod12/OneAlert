"""Tests for OAuth cookie-based token delivery."""

import pytest
from fastapi import HTTPException


def test_cookie_max_age_is_reasonable():
    """Cookie max_age should be based on token expiry config."""
    from backend.config import settings
    max_age = settings.access_token_expire_minutes * 60
    assert max_age > 0
    assert max_age <= 86400  # Max 24 hours


def test_oauth2_scheme_allows_optional_token():
    """OAuth2 scheme should not auto-error to allow cookie fallback."""
    from backend.routers.auth import oauth2_scheme
    assert oauth2_scheme.auto_error is False


def test_github_authorization_url_encodes_state():
    """GitHub authorization URL should encode state and redirect parameters."""
    from backend.services.github_auth_service import GitHubAuthService

    service = GitHubAuthService()
    service.client_id = "client-id"
    service.client_secret = "client-secret"
    service.redirect_uri = "https://example.test/auth/callback"

    url = service.get_authorization_url("state with spaces&symbols")

    assert "client_id=client-id" in url
    assert "redirect_uri=https%3A%2F%2Fexample.test%2Fauth%2Fcallback" in url
    assert "state=state+with+spaces%26symbols" in url


@pytest.mark.asyncio
async def test_github_token_exchange_rejects_state_mismatch_before_network():
    """State mismatch should fail before any token exchange request is made."""
    from backend.services.github_auth_service import GitHubAuthService

    service = GitHubAuthService()
    service.client_id = "client-id"
    service.client_secret = "client-secret"

    with pytest.raises(HTTPException) as exc:
        await service.exchange_code_for_token("code", "expected-state", "received-state")

    assert exc.value.status_code == 400
