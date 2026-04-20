"""Tests for Phase 10: Observability & Operational Maturity."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.main import app
from backend.middleware.metrics import reset_metrics, get_metrics_summary, _request_counts
from backend.logging_config import get_logger, setup_logging


@pytest.fixture(autouse=True)
def clean_metrics():
    """Reset metrics before each test."""
    reset_metrics()
    yield
    reset_metrics()


client = TestClient(app, raise_server_exceptions=False)


def test_health_live_returns_200():
    """GET /health/live returns 200 with status ok."""
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_health_ready_returns_status():
    """GET /health/ready returns healthy status when DB is reachable."""
    response = client.get("/health/ready")
    # Should return 200 with status ready (SQLite always available in tests)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["database"] == "connected"


def test_metrics_endpoint_returns_data():
    """GET /metrics returns metrics data structure."""
    # Make a request first so there is data
    client.get("/health/live")
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "data" in data


def test_metrics_middleware_tracks_requests():
    """Metrics middleware tracks request counts correctly."""
    reset_metrics()
    # Make several requests
    client.get("/health/live")
    client.get("/health/live")
    client.get("/health/live")

    summary = get_metrics_summary()
    # The /health/live endpoint should have been counted
    assert "GET /health/live" in summary
    assert summary["GET /health/live"]["count"] >= 3


def test_structured_logger_instantiation():
    """Structured logger can be instantiated without error."""
    log = get_logger("test_module")
    assert log is not None
    # Verify it has standard logging methods
    assert callable(getattr(log, "info", None))
    assert callable(getattr(log, "error", None))
    assert callable(getattr(log, "warning", None))
