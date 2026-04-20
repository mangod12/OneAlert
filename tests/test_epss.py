"""Tests for the EPSS (Exploit Prediction Scoring System) service."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from backend.services.epss_service import get_epss_score, EPSS_API_URL


@pytest.mark.asyncio
async def test_valid_cve_returns_score_and_percentile():
    """Valid CVE should return score and percentile from EPSS API."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "status": "OK",
        "data": [
            {
                "cve": "CVE-2024-1234",
                "epss": "0.97",
                "percentile": "0.99"
            }
        ]
    }

    with patch("backend.services.epss_service.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await get_epss_score("CVE-2024-1234")

    assert result is not None
    assert result["score"] == 0.97
    assert result["percentile"] == 0.99


@pytest.mark.asyncio
async def test_invalid_cve_returns_none():
    """CVE not found in EPSS database should return None."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "status": "OK",
        "data": []
    }

    with patch("backend.services.epss_service.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await get_epss_score("CVE-9999-99999")

    assert result is None


@pytest.mark.asyncio
async def test_empty_cve_id_returns_none():
    """Empty or None CVE ID should return None without making API call."""
    result = await get_epss_score("")
    assert result is None

    result = await get_epss_score(None)
    assert result is None


@pytest.mark.asyncio
async def test_network_error_returns_none():
    """Network errors should be handled gracefully and return None."""
    with patch("backend.services.epss_service.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get.side_effect = Exception("Connection timeout")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await get_epss_score("CVE-2024-5678")

    assert result is None


@pytest.mark.asyncio
async def test_non_200_status_returns_none():
    """Non-200 HTTP status should return None."""
    mock_response = MagicMock()
    mock_response.status_code = 500

    with patch("backend.services.epss_service.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await get_epss_score("CVE-2024-5678")

    assert result is None


@pytest.mark.asyncio
async def test_epss_score_parsed_as_float():
    """EPSS scores should be parsed as floats even if API returns strings."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "status": "OK",
        "data": [
            {
                "cve": "CVE-2023-4567",
                "epss": "0.00234",
                "percentile": "0.45678"
            }
        ]
    }

    with patch("backend.services.epss_service.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await get_epss_score("CVE-2023-4567")

    assert result is not None
    assert isinstance(result["score"], float)
    assert isinstance(result["percentile"], float)
    assert abs(result["score"] - 0.00234) < 1e-6
    assert abs(result["percentile"] - 0.45678) < 1e-6
