"""A failed or partial analysis cannot be presented as complete triage or an all-clear."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.routers.cases import auto_triage
from backend.services.agents.triage import TriageAgent


@pytest.mark.asyncio
@pytest.mark.parametrize(('outcomes', 'expected'), [
    ([object(), None], 'completed'), ([ValueError('bad evidence'), None], 'partial'),
    ([ValueError('bad evidence'), ValueError('unavailable')], 'failed'),
    ([object(), ValueError('bad evidence')], 'partial'),
])
async def test_group_failures_and_nonincident_decisions_are_counted_separately(outcomes, expected):
    agent = TriageAgent(db=MagicMock(), user_id=1)
    agent._get_untriaged_alerts = AsyncMock(return_value=[object(), object()])
    agent._get_untriaged_events = AsyncMock(return_value=[])
    agent._group_by_correlation = MagicMock(return_value=[{'alerts': [object()], 'events': []}] * 2)
    agent._analyze_and_create_case = AsyncMock(side_effect=outcomes)
    result = await agent.run()
    assert result['status'] == expected and result['groups_total'] == 2
    assert result['groups_failed'] == sum(isinstance(value, Exception) for value in outcomes)
    assert result['groups_nonincident'] == sum(value is None for value in outcomes)
    assert result['cases_created'] == sum(value is not None and not isinstance(value, Exception) for value in outcomes)
    if expected != 'completed':
        assert 'failed and need review or retry' in result['summary']


@pytest.mark.asyncio
async def test_no_selected_evidence_is_complete_empty_not_failed():
    agent = TriageAgent(db=MagicMock(), user_id=1)
    agent._get_untriaged_alerts = AsyncMock(return_value=[])
    agent._get_untriaged_events = AsyncMock(return_value=[])
    result = await agent.run()
    assert result['status'] == 'completed' and result['groups_total'] == result['groups_failed'] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['completed', 'partial', 'failed'])
async def test_agent_ledger_preserves_reported_run_outcome(status):
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    agent = TriageAgent(db=db, user_id=1)
    agent.run = AsyncMock(return_value={'status': status, 'summary': 'Recorded outcome'})
    await agent.execute()
    assert agent._run.status == status and agent._run.completed_at is not None
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(('detect', 'triage', 'expected'), [
    ({'summary': 'Done'}, {'status': 'completed'}, 'completed'),
    (RuntimeError('Unavailable'), {'status': 'completed'}, 'partial'),
    ({'summary': 'Done'}, {'status': 'partial'}, 'partial'),
    ({'summary': 'Done'}, {'status': 'failed'}, 'partial'),
    (RuntimeError('Unavailable'), {'status': 'failed'}, 'failed'),
    (RuntimeError('Unavailable'), RuntimeError('Unavailable'), 'failed'),
])
async def test_pipeline_aggregates_actual_stage_outcomes(monkeypatch, detect, triage, expected):
    from backend.services.agents import orchestrator
    monkeypatch.setattr(orchestrator.DetectAgent, 'execute', AsyncMock(
        side_effect=detect if isinstance(detect, Exception) else None,
        return_value=None if isinstance(detect, Exception) else detect))
    monkeypatch.setattr(orchestrator.TriageAgent, 'execute', AsyncMock(
        side_effect=triage if isinstance(triage, Exception) else None,
        return_value=None if isinstance(triage, Exception) else triage))
    result = await orchestrator.run_pipeline(MagicMock(), 1)
    assert result['pipeline_status'] == expected


@pytest.mark.asyncio
async def test_auto_triage_reports_only_its_own_run_not_global_case_count_delta(monkeypatch):
    payload = {'status': 'partial', 'cases_created': 2, 'alerts_triaged': 4, 'events_triaged': 7,
               'groups_total': 3, 'groups_failed': 1, 'groups_nonincident': 0, 'summary': 'One group failed'}
    monkeypatch.setattr(TriageAgent, 'execute', AsyncMock(return_value=payload))
    db = AsyncMock()
    result = await auto_triage(hours_back=72, current_user=SimpleNamespace(id=1), db=db)
    assert result['data'] == payload
    db.execute.assert_not_awaited()
