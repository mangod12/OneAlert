"""Tests for rate limiting middleware."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_rate_limit_handler_returns_429():
    """Rate limit exceeded handler returns proper 429 response."""
    from backend.middleware.rate_limiter import rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    mock_request = AsyncMock()
    mock_limit = MagicMock()
    mock_limit.error_message = None
    exc = RateLimitExceeded(mock_limit)
    response = await rate_limit_exceeded_handler(mock_request, exc)
    assert response.status_code == 429


@pytest.mark.asyncio
async def test_limiter_is_configured():
    """Limiter should be configured with default limits."""
    from backend.middleware.rate_limiter import limiter
    assert limiter is not None
    assert limiter._default_limits is not None
