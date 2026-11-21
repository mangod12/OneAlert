"""Read-only local-handler preflight never simulates or authorizes an action."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.services.response_preflight import simulation_preflight
from tests.test_response_decision_evidence import client as evidence_client

client = evidence_client


def preview(actions):
    return simulation_preflight(SimpleNamespace(actions=actions))


def test_stable_priority_order_and_handler_support_are_distinct_from_policy():
    result = preview([{'action_type': 'notify', 'target': 'local', 'priority': 2, 'policy_check': {'approved': False}},
                      {'action_type': 'unknown', 'target': 'local', 'priority': 0},
                      {'action_type': 'ticket', 'target': 'local', 'priority': 2},
                      {'action_type': 'notify', 'target': 'local'}])
    assert result['supported_count'] == 3 and result['unsupported_count'] == 1
    assert result['invalid_count'] == 0 and result['order_available']
    assert [row['simulation_order'] for row in result['records']] == [2, 1, 3, 4]
    assert result['records'][0]['recorded_policy_approved'] is False
    assert result['records'][3]['priority_defaulted'] and result['records'][3]['priority'] == 99


@pytest.mark.parametrize('bad', [None, 'first', True, float('inf'), float('nan'), 10**100])
def test_invalid_priorities_hide_whole_order_instead_of_guessing(bad):
    result = preview([{'action_type': 'notify', 'target': 'local', 'priority': bad},
                      {'action_type': 'ticket', 'target': 'local', 'priority': 0}])
    assert not result['order_available'] and result['invalid_count'] == 1
    assert all(row['simulation_order'] is None for row in result['records'])


@pytest.mark.parametrize('actions', [None, {}, 'wrong', []])
def test_missing_or_empty_list_is_not_runnable(actions):
    result = preview(actions)
    assert not result['shape_valid'] and not result['order_available'] and not result['records']


def test_legacy_shapes_do_not_crash_or_expose_nested_values_as_targets():
    result = preview([None, [], {'action_type': {}, 'target': {'secret': 'not-a-target'}},
                      {'action_type': 'notify', 'target': ' '},
                      {'action_type': 'notify', 'target': 'local', 'policy_check': []}])
    assert result['invalid_count'] == 4
    assert result['records'][2]['target'] is None and result['records'][2]['action_type'] is None
    assert 'not-a-target' not in str(result)
    assert result['records'][4]['recorded_policy_approved'] is None


def test_owned_http_read_does_not_run_handlers_or_change_plan(client):
    before = client.get('/api/v1/response-plans/7/decision-evidence').json()
    with patch('backend.services.action_executor._execute_notify', new_callable=AsyncMock) as handler:
        response = client.get('/api/v1/response-plans/7/simulation-preflight')
        assert response.status_code == 200
        result = response.json()
        assert result['plan_id'] == 7 and result['case_id'] == 10 and result['status'] == 'partial'
        assert result['execution_mode'] == 'simulated' and result['retrieved_at']
        assert result['action_count'] == 2 and result['supported_count'] == 1
        assert result['unsupported_count'] == 1 and result['invalid_count'] == 0
        assert 'not a configured live integration' in ' '.join(result['limitations'])
        handler.assert_not_awaited()
    after = client.get('/api/v1/response-plans/7/decision-evidence').json()
    assert after['plan'] == before['plan'] and after['approval_records'] == before['approval_records']
    assert 'user_id' not in result and 'approved_by' not in result


@pytest.mark.parametrize('plan', [8, 999])
def test_foreign_and_missing_plan_share_404(client, plan):
    response = client.get(f'/api/v1/response-plans/{plan}/simulation-preflight')
    assert response.status_code == 404 and response.json()['error']['message'] == 'Response plan not found'


@pytest.mark.asyncio
async def test_oversized_plan_refuses_without_partial_preview_or_mutation():
    from unittest.mock import MagicMock

    from fastapi import HTTPException

    from backend.routers.response_plans import read_simulation_preflight
    plan = SimpleNamespace(id=7, case_id=10, status='draft', actions=[{}] * 5001)
    db = AsyncMock()
    query = MagicMock()
    query.scalar_one_or_none.return_value = plan
    db.execute.return_value = query
    with pytest.raises(HTTPException) as caught:
        await read_simulation_preflight(7, SimpleNamespace(id=1), db)
    assert caught.value.status_code == 422 and 'No partial' in caught.value.detail
    db.commit.assert_not_awaited()
    db.flush.assert_not_awaited()
