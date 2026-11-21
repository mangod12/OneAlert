"""Cross-run step discovery searches full saved summaries, not only current library or inspector pages."""
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from test_agent_run_detail import ledger as ledger

from backend.models.case import AgentRun, AgentStep
from backend.routers.agent_step_search import _excerpt

PATH = '/api/v1/cases/agents/step-search'


def seed(ledger):
    client, owner, other, _, sessions = ledger
    with sessions() as db:
        for index in range(55):
            run = AgentRun(user_id=owner.id, agent_type='hunt' if index % 2 else 'detect',
                status='failed' if index % 2 else 'completed',
                started_at=datetime(2026, 11, 1, tzinfo=UTC), error_message='Private unsearched failure',
                result_summary='Unsearched result')
            db.add(run)
            db.flush()
            db.add(AgentStep(run_id=run.id, step_number=1, action='inspect', tool_used='local_tool',
                input_summary=f'Candidate 100%_literal {index}',
                output_summary='x' * 900 + 'TARGET 100%_literal' + 'y' * 900))
        run = AgentRun(user_id=other.id, agent_type='foreign-agent', status='failed')
        db.add(run)
        db.flush()
        db.add(AgentStep(run_id=run.id, step_number=1, action='inspect',
            input_summary='Candidate 100%_literal private foreign content'))
        db.commit()
    return client


def test_complete_owned_step_pages_are_stable_and_exclude_unsearched_private_fields(ledger):
    client = seed(ledger)
    pages = [client.get(PATH, params={'query': ' 100%_LITERAL ', 'page': page}).json() for page in range(1, 7)]
    assert [len(p['records']) for p in pages] == [10, 10, 10, 10, 10, 5]
    assert all(p['total'] == 55 and p['query'] == '100%_LITERAL' for p in pages)
    ids = [r['run_id'] for p in pages for r in p['records']]
    assert ids == sorted(ids, reverse=True) and len(set(ids)) == 55
    assert 'foreign-agent' not in str(pages) and 'private foreign content' not in str(pages)
    assert 'Private unsearched failure' not in str(pages) and 'Unsearched result' not in str(pages)
    record = pages[0]['records'][0]
    assert record['matched_fields'] == ['input_summary', 'output_summary']
    assert record['excerpts']['output_summary']['shortened'] is True
    assert record['excerpts']['output_summary']['recorded_length'] > 1800
    assert 'TARGET 100%_literal' in record['excerpts']['output_summary']['text']
    assert len(record['excerpts']['output_summary']['text']) == 500
    assert client.get(PATH, params={'query': '100%_literal', 'page': 99}).json()['records'] == []


def test_field_and_exact_run_filters_apply_before_paging_without_wildcards_or_execution(ledger):
    client = seed(ledger)
    with patch('backend.services.agents.hunt.HuntAgent.execute', new_callable=AsyncMock) as execute:
        data = client.get(PATH, params={'query': 'target', 'field': 'output_summary',
            'agent_type': 'hunt', 'run_status': 'failed', 'page': 2}).json()
        assert data['total'] == 27 and len(data['records']) == 10
        assert all(r['matched_fields'] == ['output_summary'] and r['agent_type'] == 'hunt'
                   and r['run_status'] == 'failed' for r in data['records'])
        assert client.get(PATH, params={'query': 'local_tool', 'field': 'tool_used'}).json()['total'] == 55
        assert client.get(PATH, params={'query': 'inspect', 'field': 'action'}).json()['total'] == 55
        for query in ('100xxliteral', 'Private unsearched failure', 'Unsearched result', 'private foreign content'):
            assert client.get(PATH, params={'query': query}).json()['total'] == 0
        execute.assert_not_called()


@pytest.mark.parametrize('params', [{}, {'query': ''}, {'query': '   '}, {'query': 'x' * 201},
    {'query': 'x', 'field': 'duration'}, {'query': 'x', 'page': 0}, {'query': 'x', 'size': 101},
    {'query': 'x', 'agent_type': 'a' * 101}, {'query': 'x', 'run_status': 'a' * 101}])
def test_query_bounds(ledger, params):
    assert ledger[0].get(PATH, params=params).status_code == 422


def test_short_and_missing_excerpts_preserve_empty_and_null_values():
    assert _excerpt(None, 'x') == {'text': None, 'shortened': False, 'recorded_length': None}
    assert _excerpt('', 'x') == {'text': '', 'shortened': False, 'recorded_length': 0}
    text = 'İ' * 700 + 'TARGET' + '尾' * 700
    value = _excerpt(text, 'target')
    assert len(value['text']) <= 500 and 'TARGET' in value['text'] and value['shortened']


def test_inactive_and_unauthenticated_reads_are_refused(ledger):
    from backend.main import app
    from backend.routers.auth import get_current_user
    client, owner, *_ = ledger
    owner.is_active = False
    assert client.get(PATH, params={'query': 'analyze'}).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get(PATH, params={'query': 'analyze'}).status_code == 401


def test_other_account_admin_sees_only_its_own_step_evidence(ledger):
    from backend.main import app
    from backend.routers.auth import get_current_user
    client = seed(ledger)
    other = ledger[2]
    other.role = 'admin'
    async def current_user():
        return other
    app.dependency_overrides[get_current_user] = current_user
    data = client.get(PATH, params={'query': '100%_literal'}).json()
    assert data['total'] == 1 and data['records'][0]['agent_type'] == 'foreign-agent'
    assert client.get(PATH, params={'query': 'TARGET'}).json()['total'] == 0
