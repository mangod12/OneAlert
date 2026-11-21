"""All owned ledger runs are discoverable beyond the latest-50 preview."""
from datetime import UTC, datetime

import pytest
from test_agent_run_detail import ledger as ledger

from backend.models.case import AgentRun

PATH = '/api/v1/cases/agents/run-library'


def seed(ledger):
    client, owner, other, _, sessions = ledger
    with sessions() as db:
        for index in range(61):
            db.add(AgentRun(user_id=owner.id, agent_type='triage' if index % 2 else 'hunt',
                            status='failed' if index % 2 else 'completed',
                            model_used='recorded-model' if index % 2 else None,
                            started_at=datetime(2026, 11, 1, tzinfo=UTC),
                            result_summary=f'Review 100%_safe {index}', error_message='not-searchable-error'))
        db.add(AgentRun(user_id=other.id, agent_type='private-agent', status='private-status',
                        model_used='private-model', result_summary='Review 100%_safe private'))
        db.commit()
    return client


def test_complete_stable_pages_and_owned_option_counts(ledger):
    client = seed(ledger)
    pages = [client.get(PATH, params={'query': ' 100%_SAFE ', 'page': page}).json() for page in (1, 2, 3, 4)]
    assert [len(page['records']) for page in pages] == [20, 20, 20, 1]
    ids = [row['id'] for page in pages for row in page['records']]
    assert len(set(ids)) == 61 and ids == sorted(ids, reverse=True)
    assert all(page['total'] == 61 and page['query'] == '100%_SAFE' for page in pages)
    assert pages[0]['agent_types'] == ['hunt', 'triage']
    assert pages[0]['statuses'] == ['completed', 'failed']
    assert pages[0]['models'] == ['recorded-model']
    assert 'private' not in str(pages) and 'error_message' not in str(pages) and 'steps' not in str(pages)
    assert len(client.get('/api/v1/cases/agents/runs').json()) == 50
    assert client.get(PATH, params={'page': 999}).json()['records'] == []


def test_exact_filter_combination_literal_search_and_old_record_inspection(ledger):
    client = seed(ledger)
    data = client.get(PATH, params={'query': '100%_', 'agent_type': 'triage',
                                   'run_status': 'failed', 'model': 'recorded-model', 'page': 2}).json()
    assert data['total'] == 30 and len(data['records']) == 10
    assert all(row['agent_type'] == 'triage' and row['status'] == 'failed'
               and row['model_used'] == 'recorded-model' for row in data['records'])
    oldest = data['records'][-1]['id']
    assert client.get(f'/api/v1/cases/agents/runs/{oldest}').json()['id'] == oldest
    assert client.get(PATH, params={'query': str(oldest)}).json()['total'] > 0
    for query in ('100xxsafe', 'not-searchable-error', 'private-agent'):
        assert client.get(PATH, params={'query': query}).json()['total'] == 0
    assert client.get(PATH, params={'agent_type': 'hunt', 'run_status': 'failed'}).json()['total'] == 0
    assert client.get(PATH, params={'query': 'recorded-model'}).json()['total'] == 30


@pytest.mark.parametrize('params', [{'page': 0}, {'size': 101}, {'query': 'x' * 201},
                                    {'agent_type': 'x' * 101}, {'run_status': 'x' * 101}, {'model': 'x' * 201}])
def test_invalid_library_scope(ledger, params):
    assert ledger[0].get(PATH, params=params).status_code == 422


def test_inactive_and_unauthenticated_reads_fail(ledger):
    from backend.main import app
    from backend.routers.auth import get_current_user

    client, owner, *_ = ledger
    owner.is_active = False
    assert client.get(PATH).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get(PATH).status_code == 401
