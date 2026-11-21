"""An agent returning an explicit error must not save a completed run."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.services.agents.base import BaseAgent


class ResultAgent(BaseAgent):
    agent_type = 'test'

    async def run(self, **kwargs):
        return kwargs['result']


@pytest.mark.asyncio
@pytest.mark.parametrize(('result', 'expected'), [
    ({'error': 'Case not found'}, 'failed'),
    ({'error': 'No hunting hypothesis provided', 'status': 'completed'}, 'failed'),
    ({'error': 'Recorded error', 'status': 'partial'}, 'failed'),
    ({'status': 'cancelled', 'summary': 'Cancelled before analysis'}, 'cancelled'),
    ({'status': 'partial', 'summary': 'Partial analysis'}, 'partial'),
    ({'status': 'failed', 'summary': 'Failed analysis'}, 'failed'),
    ({'status': 'pending_approval', 'summary': 'Created a plan, not executed'}, 'completed'),
    ({'status': 'approved', 'summary': 'Created a plan, not executed'}, 'completed'),
    ({'error': '', 'summary': 'No error'}, 'completed'),
    ({'summary': 'Recorded success'}, 'completed'),
])
async def test_saved_execution_outcome_distinguishes_error_from_success_and_business_status(result, expected):
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    agent = ResultAgent(db, 1)
    returned = await agent.execute(result=result)
    assert returned is result and agent._run.status == expected
    assert agent._run.completed_at is not None
    assert agent._run.result_summary == result.get('summary', '')
    assert agent._run.error_message == (result['error'] if result.get('error') else None)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_recorded_explicit_error_obeys_existing_ledger_text_bound():
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    agent = ResultAgent(db, 1)
    result = {'error': 'x' * 800}
    await agent.execute(result=result)
    assert agent._run.error_message == 'x' * 500
    assert len(result['error']) == 800
