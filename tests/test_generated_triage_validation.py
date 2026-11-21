"""Bad generated evidence cannot partially stage a case or consume pending events."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.services.agents.triage import TriageAgent
from backend.services.triage_output import validate_triage_output


@pytest.mark.parametrize('generated', [
    None, [], {}, {'is_incident': 'false'}, {'is_incident': 0},
    *[{'is_incident': True, **change} for change in [
        {'title': None}, {'title': []}, {'title': ' '}, {'summary': {}}, {'attack_narrative': []},
        {'severity': 'urgent'}, {'severity': []}, {'confidence': True}, {'confidence': '0.8'},
        {'confidence': -1}, {'confidence': 2}, {'confidence': float('nan')}, {'confidence': float('inf')},
        {'mitre_tactics': 'TA0001'}, {'mitre_tactics': [None]}, {'recommended_actions': 'Review'},
        {'recommended_actions': [{}]}, {'recommended_actions': ['Review'] * 101},
        {'mitre_techniques': {}}, {'mitre_techniques': [{}]}, {'mitre_techniques': [None]},
        {'mitre_techniques': [{'id': 'T1078', 'name': []}]},
        {'mitre_techniques': [{'id': 'T1078', 'confidence': True}]},
    ]],
])
@pytest.mark.asyncio
async def test_invalid_generated_triage_has_no_case_link_or_event_side_effect(monkeypatch, generated):
    from backend.services.agents import triage
    provider = SimpleNamespace(model='local-test', complete_json=AsyncMock(return_value=generated))
    monkeypatch.setattr(triage, 'get_ai_provider', lambda _: provider)
    db = MagicMock()
    db.flush = AsyncMock()
    event = SimpleNamespace(id=1, severity='high', event_type='dns', source_ip=None, dest_ip=None,
                            source_port=None, dest_port=None, signature='Synthetic', category=None, processed='pending')
    with pytest.raises(ValueError, match='Generated triage'):
        await TriageAgent(db=db, user_id=1)._analyze_and_create_case({'alerts': [], 'events': [event]})
    db.add.assert_not_called()
    db.flush.assert_not_awaited()
    assert event.processed == 'pending'


@pytest.mark.parametrize('confidence', [0, 1, 0.8])
def test_valid_explicit_evidence_is_preserved_without_inventing_techniques(confidence):
    value = {'is_incident': True, 'title': 'Recorded case', 'confidence': confidence,
             'mitre_tactics': ['TA0001'], 'mitre_techniques': ['T1078', {'id': 'T1021', 'name': 'Remote Services',
                                                                         'confidence': 0.8}],
             'recommended_actions': ['Review saved evidence']}
    assert validate_triage_output(value) is value


def test_explicit_nonincident_is_not_reinterpreted_and_missing_decision_is_not_assumed():
    assert validate_triage_output({'is_incident': False}) == {'is_incident': False}
    with pytest.raises(ValueError):
        validate_triage_output({'title': 'No actual decision supplied'})
