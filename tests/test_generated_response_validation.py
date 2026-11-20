"""Malformed generated plans must not be saved or silently treated as approved."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.services.agents.response import ResponseAgent


@pytest.mark.asyncio
@pytest.mark.parametrize('generated', [
    None, [], {}, {'actions': None}, {'actions': []}, {'actions': 'notify'},
    {'actions': [None]}, {'actions': [[]]}, {'actions': [{}]},
    {'actions': [{'action_type': ['notify'], 'target': 'soc', 'reason': 'Review'}]},
    {'actions': [{'action_type': 'unsupported', 'target': 'soc', 'reason': 'Review'}]},
    {'actions': [{'action_type': 'notify', 'target': None, 'reason': 'Review'}]},
    {'actions': [{'action_type': 'notify', 'target': ' ', 'reason': 'Review'}]},
    {'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': []}]},
    {'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': ' '}]},
    *[{'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': 'Review', 'priority': value}]}
      for value in [None, True, -1, '1', 0.5]],
    {'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': 'Review',
                  'execution_result': {'status': 'completed'}}]},
    {'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': 'Review'}] * 101},
])
async def test_rejects_generated_actions_before_saving_any_plan(monkeypatch, generated):
    from backend.services.agents import response
    db = MagicMock()
    case = SimpleNamespace(id=7, title='Case', severity='high', summary='Review', mitre_tactics=[])
    db.execute = AsyncMock(side_effect=[MagicMock(scalar_one_or_none=lambda: case), MagicMock(all=list)])
    provider = SimpleNamespace(model='local-mock', complete_json=AsyncMock(return_value=generated))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _task: provider)
    with pytest.raises(ValueError, match='Generated response'):
        await ResponseAgent(db=db, user_id=1).run(case_id=7)
    db.add.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('priority_fields', [{}, {'priority': 0}, {'priority': 1}])
async def test_valid_generated_action_is_saved_with_policy_without_inventing_execution(monkeypatch, priority_fields):
    from backend.models.response_plan import ResponsePlan
    from backend.services.agents import response
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    case = SimpleNamespace(id=7, title='Case', severity='high', summary='Review', mitre_tactics=[])
    db.execute = AsyncMock(side_effect=[MagicMock(scalar_one_or_none=lambda: case), MagicMock(all=list)])
    action = {'action_type': 'notify', 'target': 'soc', 'reason': 'Human review', **priority_fields}
    provider = SimpleNamespace(model='local-mock', complete_json=AsyncMock(return_value={'actions': [action]}))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _task: provider)
    result = await ResponseAgent(db=db, user_id=1).run(case_id=7, autonomy_level='L1')
    saved = db.add.call_args_list[0].args[0]
    assert isinstance(saved, ResponsePlan)
    assert saved.actions[0]['target'] == 'soc'
    assert saved.actions[0]['policy_check']['approved'] is True
    assert 'execution_result' not in saved.actions[0]
    assert result['needs_approval'] is False
    db.commit.assert_awaited_once()
