"""Tests for purple-team validation agent and models."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.services.agents.purple import PurpleAgent, ATOMIC_TESTS


class TestAtomicTestLibrary:
    """Test the built-in atomic test library."""

    def test_has_multiple_techniques(self):
        assert len(ATOMIC_TESTS) >= 8

    def test_each_technique_has_tests(self):
        for tech_id, data in ATOMIC_TESTS.items():
            assert "name" in data
            assert "tests" in data
            assert len(data["tests"]) >= 1
            for test in data["tests"]:
                assert "test_name" in test
                assert "command" in test
                assert "expected_detection" in test

    def test_technique_ids_are_valid(self):
        for tech_id in ATOMIC_TESTS:
            assert tech_id.startswith("T")
            assert len(tech_id) >= 4


class TestPurpleAgentSimulation:
    """Test purple agent simulation logic."""

    def test_simulate_returns_valid_result(self):
        agent = PurpleAgent.__new__(PurpleAgent)
        for tech_id in ATOMIC_TESTS:
            result = agent._simulate_test(tech_id, "dry_run")
            assert result in ("detected", "missed")

    def test_simulate_unknown_technique_uses_default_rate(self):
        agent = PurpleAgent.__new__(PurpleAgent)
        result = agent._simulate_test("T9999", "dry_run")
        assert result in ("detected", "missed")


class TestValidationModels:
    """Test validation model creation and schemas."""

    def test_validation_run_create_schema(self):
        from backend.models.validation import ValidationRunCreate
        run = ValidationRunCreate(
            name="Test Run",
            description="Testing detection coverage",
            mode="dry_run",
            mitre_techniques=["T1059", "T1071"],
        )
        assert run.name == "Test Run"
        assert run.mode == "dry_run"
        assert len(run.mitre_techniques) == 2

    def test_validation_run_create_defaults(self):
        from backend.models.validation import ValidationRunCreate
        run = ValidationRunCreate(name="Minimal Run")
        assert run.mode == "dry_run"
        assert run.mitre_techniques == []
        assert run.scope is None

    def test_validation_run_response_schema(self):
        from backend.models.validation import ValidationRunResponse
        from datetime import datetime, timezone
        resp = ValidationRunResponse(
            id=1,
            name="Test",
            status="completed",
            mode="dry_run",
            created_at=datetime.now(timezone.utc),
        )
        assert resp.id == 1
        assert resp.status == "completed"


class TestDetectionCoverage:
    """Test detection rate simulation."""

    def test_detection_rates_are_realistic(self):
        """Detection rates should be between 0 and 1."""
        agent = PurpleAgent.__new__(PurpleAgent)
        results = {"detected": 0, "missed": 0}

        # Run many simulations to verify distribution
        for _ in range(1000):
            for tech_id in ATOMIC_TESTS:
                result = agent._simulate_test(tech_id, "dry_run")
                results[result] += 1

        total = results["detected"] + results["missed"]
        rate = results["detected"] / total
        # Overall rate should be between 40% and 95%
        assert 0.4 < rate < 0.95, f"Overall detection rate {rate:.2%} outside expected range"
