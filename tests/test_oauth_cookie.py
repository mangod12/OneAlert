"""Tests for OAuth cookie-based token delivery."""

import pytest


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
