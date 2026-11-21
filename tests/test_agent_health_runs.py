"""Drill down exact health-group identity and UTC start scope, including empty labels."""
from datetime import UTC, datetime

import pytest
from test_agent_recorded_health import seed
from test_agent_run_detail import ledger as ledger

from backend.models.case import AgentRun

PATH = '/api/v1/cases/agents/recorded-health/runs'


def test_complete_stable_group_pages_preserve_owner_and_date_scope(ledger):
    client = seed(ledger)
    params = {'agent_type': 'hunt', 'run_status': 'failed',
              'from_date': '2026-11-01', 'before_date': '2026-11-02'}
    pages = [client.get(PATH, params={**params, 'page': index}).json() for index in (1, 2, 3)]
    assert [len(page['records']) for page in pages] == [10, 10, 10]
    ids = [row['id'] for page in pages for row in page['records']]
    assert len(set(ids)) == 30 and ids == sorted(ids, reverse=True)
    assert all(page['total'] == 30 and page['agent_type'] == 'hunt' and page['run_status'] == 'failed'
               and page['from_date'] == '2026-11-01' and page['before_date'] == '2026-11-02' for page in pages)
    assert 'result_summary' not in str(pages) and 'error_message' not in str(pages) and 'user_id' not in str(pages)
    assert client.get(PATH, params={**params, 'page': 99}).json()['records'] == []
    assert client.get(PATH, params={**params, 'from_date': '2026-11-02',
                                   'before_date': '2026-11-03'}).json()['total'] == 0


def test_empty_labels_are_exact_identities_never_all_groups(ledger):
    client, owner, _, _, sessions = ledger
    with sessions() as db:
        db.add_all([AgentRun(user_id=owner.id, agent_type='', status='',
                            started_at=datetime(2026, 11, 1, tzinfo=UTC)),
                    AgentRun(user_id=owner.id, agent_type='all', status='all'),
                    AgentRun(user_id=owner.id, agent_type='hunt', status='failed')])
        db.commit()
    data = client.get(PATH, params={'agent_type': '', 'run_status': ''}).json()
    assert data['total'] == 1 and data['records'][0]['agent_type'] == data['records'][0]['status'] == ''
    assert client.get(PATH, params={'agent_type': 'all', 'run_status': 'all'}).json()['total'] == 1
    assert client.get(PATH, params={'agent_type': 'HUNT', 'run_status': 'failed'}).json()['total'] == 0


@pytest.mark.parametrize('params', [{}, {'agent_type': 'hunt'}, {'run_status': 'failed'},
    {'agent_type': 'x' * 101, 'run_status': 'failed'},
    {'agent_type': 'hunt', 'run_status': 'failed', 'page': 0},
    {'agent_type': 'hunt', 'run_status': 'failed', 'size': 101},
    {'agent_type': 'hunt', 'run_status': 'failed', 'from_date': '2026-11-02', 'before_date': '2026-11-01'}])
def test_invalid_or_missing_exact_scope_is_refused(ledger, params):
    assert ledger[0].get(PATH, params=params).status_code == 422


def test_foreign_admin_and_inactive_unauthenticated_isolation(ledger):
    from backend.main import app
    from backend.routers.auth import get_current_user
    client, owner, other, *_ = ledger
    params = {'agent_type': 'triage', 'run_status': 'failed'}
    assert client.get(PATH, params=params).json()['total'] == 1
    owner.is_active = False
    assert client.get(PATH, params=params).status_code == 400
    other.role = 'admin'
    async def foreign():
        return other
    app.dependency_overrides[get_current_user] = foreign
    assert client.get(PATH, params=params).json()['total'] == 0
    app.dependency_overrides.pop(get_current_user)
    assert client.get(PATH, params=params).status_code == 401
