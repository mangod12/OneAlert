"""Tests for purple-team validation agent and models."""

from datetime import UTC

import pytest

from backend.services.agents.purple import ATOMIC_TESTS


class TestAtomicTestLibrary:
    """Test the built-in atomic test library."""

    def test_has_multiple_techniques(self):
        assert len(ATOMIC_TESTS) >= 8

    def test_each_technique_has_tests(self):
        for data in ATOMIC_TESTS.values():
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
    """Simulation plans validate known techniques without randomized measurements."""

    def test_all_library_techniques_are_validated_without_fake_detection_rates(self):
        from backend.services.agents.purple import simulation_techniques
        assert simulation_techniques(list(ATOMIC_TESTS)) == list(ATOMIC_TESTS)
        assert simulation_techniques(['T1110', 'T1110']) == ['T1110']

    @pytest.mark.parametrize('value', [[], ['T9999'], ['T1110'] * 101, [True], 'T1110'])
    def test_unknown_empty_or_unbounded_plans_fail_before_preparing_steps(self, value):
        from backend.services.agents.purple import simulation_techniques
        with pytest.raises(ValueError):
            simulation_techniques(value)


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
        from datetime import datetime

        from backend.models.validation import ValidationRunResponse
        resp = ValidationRunResponse(
            id=1,
            name="Test",
            status="completed",
            mode="dry_run",
            created_at=datetime.now(UTC),
        )
        assert resp.id == 1
        assert resp.status == "completed"




def test_unknown_saved_mode_cannot_be_created_through_schema():
    from pydantic import ValidationError

    from backend.models.validation import ValidationRunCreate
    with pytest.raises(ValidationError):
        ValidationRunCreate(name='Invalid mode', mode='unexpected')
