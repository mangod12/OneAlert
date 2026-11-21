"""Complete owner-scoped execution counts with exact UTC start boundaries."""
from datetime import UTC, datetime

import pytest
from test_agent_run_detail import ledger as ledger

from backend.models.case import AgentRun

PATH = '/api/v1/cases/agents/recorded-health'


def seed(ledger):
    client, owner, other, _, sessions = ledger
    with sessions() as db:
        for index in range(61):
            db.add(AgentRun(user_id=owner.id, agent_type='hunt' if index % 2 else 'triage',
                           status='failed' if index % 2 else 'completed',
                           started_at=datetime(2026, 11, 1, tzinfo=UTC),
                           result_summary='excluded private summary', error_message='excluded failure text'))
        for index in range(7):
            db.add(AgentRun(user_id=owner.id, agent_type='hunt', status='running',
                           started_at=datetime(2026, 11, 2, index, tzinfo=UTC)))
        db.add(AgentRun(user_id=owner.id, agent_type='strange', status='other_status',
                       started_at=datetime(2026, 11, 3, tzinfo=UTC)))
        db.add(AgentRun(user_id=other.id, agent_type='foreign-agent', status='foreign-status',
                       started_at=datetime(2026, 11, 1, tzinfo=UTC)))
        db.commit()
    return client


def test_complete_counts_beyond_preview_and_bounded_oldest_running(ledger):
    client = seed(ledger)
    response = client.get(PATH, params={'from_date': '2026-11-01', 'before_date': '2026-11-04'})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['total'] == 69 and sum(row['count'] for row in data['groups']) == 69
    assert {(row['agent_type'], row['status']): row['count'] for row in data['groups']} == {
        ('hunt', 'failed'): 30, ('hunt', 'running'): 7, ('strange', 'other_status'): 1, ('triage', 'completed'): 31}
    assert len(data['oldest_running']) == 5
    assert [row['started_at'] for row in data['oldest_running']] == sorted(
        row['started_at'] for row in data['oldest_running'])
    assert 'foreign' not in str(data) and 'excluded' not in str(data)
    assert 'result_summary' not in str(data) and 'error_message' not in str(data) and 'user_id' not in str(data)


def test_exact_utc_start_boundaries_and_agent_scope(ledger):
    client = seed(ledger)
    data = client.get(PATH, params={'from_date': '2026-11-02', 'before_date': '2026-11-03',
                                   'agent_type': 'hunt'}).json()
    assert data['total'] == 7 and len(data['groups']) == 1
    assert data['from_date'] == '2026-11-02' and data['before_date'] == '2026-11-03'
    assert client.get(PATH, params={'before_date': '2026-11-02'}).json()['total'] == 61
    assert client.get(PATH, params={'agent_type': 'HUNT'}).json()['total'] == 0
    assert client.get(PATH, params={'from_date': '2099-01-01'}).json()['oldest_running'] == []


def test_default_all_history_includes_original_run_and_no_new_records(ledger):
    client = seed(ledger)
    before = client.get(PATH).json()
    assert before['total'] == 70 and before['from_date'] is None and before['before_date'] is None
    assert client.get(PATH).json()['total'] == 70


@pytest.mark.parametrize('params', [{'from_date': 'invalid'}, {'from_date': '2026-11-31'},
    {'from_date': '2026-11-03', 'before_date': '2026-11-03'},
    {'from_date': '2026-11-04', 'before_date': '2026-11-03'}, {'agent_type': 'x' * 101}])
def test_invalid_scope(ledger, params):
    assert ledger[0].get(PATH, params=params).status_code == 422


def test_inactive_unauthenticated_and_foreign_admin(ledger):
    from backend.main import app
    from backend.routers.auth import get_current_user
    client, owner, other, *_ = ledger
    owner.is_active = False
    assert client.get(PATH).status_code == 400
    owner.is_active = True
    other.role = 'admin'
    async def foreign():
        return other
    app.dependency_overrides[get_current_user] = foreign
    assert client.get(PATH).json()['total'] == 0
    app.dependency_overrides.pop(get_current_user)
    assert client.get(PATH).status_code == 401


def test_refuses_too_many_groups_without_partial_health(ledger):
    client, owner, _, _, sessions = ledger
    with sessions() as db:
        db.add_all(AgentRun(user_id=owner.id, agent_type=f'type-{index}', status='failed')
                   for index in range(1001))
        db.commit()
    response = client.get(PATH)
    assert response.status_code == 413
    assert 'groups' not in response.json()
