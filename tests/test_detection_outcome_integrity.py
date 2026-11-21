"""Unavailable or invalid generated detection is partial, never an empty successful AI review."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.services.agents.detect import DetectAgent
from backend.services.detection_output import validate_detection_output

FINDING = {'title': 'Saved generated candidate', 'description': 'A generated explanation, not confirmed activity.',
           'severity': 'high', 'affected_ips': ['10.0.0.1'], 'indicators': ['candidate'],
           'recommended_actions': ['Review original telemetry']}
STATS = {'total_events': 80, 'alert_events': 8, 'top_source_ips': {'10.0.0.1': 75},
         'top_dest_ports': {}, 'severity_distribution': {'high': 8}, 'top_signatures': {}}


@pytest.mark.parametrize('value', [None, [], {}, {'findings': None}, {'findings': {}}, {'findings': 'none'},
                                 {'findings': [None]}, {'findings': [FINDING] * 101},
                                 *[{'findings': [{**FINDING, **change}]} for change in [
                                     {'title': None}, {'title': ' '}, {'description': []}, {'severity': []},
                                     {'severity': 'urgent'}, {'affected_ips': '10.0.0.1'}, {'indicators': [None]},
                                     {'recommended_actions': [{}]}, {'affected_ips': ['']},
                                     {'recommended_actions': ['Review'] * 101}]]])
def test_malformed_ai_findings_cannot_be_counted_as_successful_empty_review(value):
    with pytest.raises(ValueError, match='Generated detection'):
        validate_detection_output(value)


def test_explicit_empty_is_distinct_from_missing_and_valid_findings_are_preserved():
    assert validate_detection_output({'findings': []}) == []
    assert validate_detection_output({'findings': [FINDING]}) == [FINDING]


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [RuntimeError('Unavailable'), {}, {'findings': ['invalid']}])
async def test_failed_generated_analysis_retains_rules_with_partial_outcome_and_saved_run_status(monkeypatch, payload):
    from backend.services.agents import detect
    provider = SimpleNamespace(complete_json=AsyncMock(side_effect=payload if isinstance(payload, Exception) else None,
                                                     return_value=payload))
    monkeypatch.setattr(detect, 'get_ai_provider', lambda _: provider)
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    agent = DetectAgent(db, 1)
    agent._aggregate_events = AsyncMock(return_value=STATS)
    result = await agent.execute(hours_back=72)
    assert result['status'] == agent._run.status == 'partial' and result['ai_status'] == 'failed'
    assert result['ai_findings_count'] == 0 and result['rule_findings_count'] == len(result['findings']) == 2
    assert 'review required' in result['summary'] and 'Only rule-based results' in result['summary']
    assert '72 hours' in provider.complete_json.call_args.args[0][1].content
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('findings', [[], [FINDING]])
async def test_valid_generated_findings_and_explicit_empty_finish_without_fallback(monkeypatch, findings):
    from backend.services.agents import detect
    provider = SimpleNamespace(complete_json=AsyncMock(return_value={'findings': findings}))
    monkeypatch.setattr(detect, 'get_ai_provider', lambda _: provider)
    agent = DetectAgent(MagicMock(), 1)
    agent._aggregate_events = AsyncMock(return_value=STATS)
    result = await agent.run(hours_back=168)
    assert result['status'] == 'completed' and result['ai_status'] == 'completed'
    assert result['ai_findings_count'] == len(findings)
    assert result['findings'] == agent._rule_based_detection(STATS) + findings
    assert '168 hours' in provider.complete_json.call_args.args[0][1].content


@pytest.mark.asyncio
@pytest.mark.parametrize('total,alerts', [(0, 0), (5, 1), (20, 0)])
async def test_not_eligible_ai_is_skipped_not_failed_or_claimed_reviewed(total, alerts):
    agent = DetectAgent(MagicMock(), 1)
    agent._aggregate_events = AsyncMock(return_value={**STATS, 'total_events': total, 'alert_events': alerts})
    agent._llm_analysis = AsyncMock()
    result = await agent.run()
    assert result['status'] == 'completed' and result['ai_status'] == 'skipped'
    agent._llm_analysis.assert_not_awaited()


@pytest.mark.asyncio
async def test_partial_detection_cannot_be_hidden_by_completed_triage(monkeypatch):
    from backend.services.agents import orchestrator
    monkeypatch.setattr(orchestrator.DetectAgent, 'execute', AsyncMock(return_value={
        'status': 'partial', 'summary': 'AI unavailable; rules only', 'findings': []}))
    monkeypatch.setattr(orchestrator.TriageAgent, 'execute', AsyncMock(return_value={
        'status': 'completed', 'summary': 'No cases created'}))
    result = await orchestrator.run_pipeline(MagicMock(), 1)
    assert result['pipeline_status'] == 'partial'
    assert result['detect']['status'] == 'partial'
