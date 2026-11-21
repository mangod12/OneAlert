"""Full plan history search shares the exact owner/filter/order scope with CSV."""
from datetime import UTC, datetime

import pytest
from test_response_plan_export import _read_csv, _register_and_login, _TestingSessionLocal
from test_response_plan_export import client as client

from backend.models.case import Case
from backend.models.response_plan import ResponsePlan


def seed(client):
    owner = _register_and_login(client, 'history-owner@example.com')
    uid = client.get('/api/v1/auth/me', headers=owner).json()['id']
    other = _register_and_login(client, 'history-other@example.com')
    foreign = client.get('/api/v1/auth/me', headers=other).json()['id']
    with _TestingSessionLocal() as db:
        case = Case(user_id=uid, title='Review case', status='open', severity='high')
        db.add(case)
        db.flush()
        case_id = case.id
        for index in range(25):
            db.add(ResponsePlan(user_id=uid, case_id=case_id, status='completed', autonomy_level='L2',
                                created_by='Analyst 100%_safe' if index >= 2 else 'Analyst 100XXsafe',
                                actions=[{'target': 'not-searchable-action-text'}],
                                created_at=datetime(2026, 11, 1, tzinfo=UTC)))
        db.add(ResponsePlan(user_id=foreign, case_id=case_id, status='completed', autonomy_level='L2',
                            created_by='Analyst 100%_safe', actions=[]))
        db.add(ResponsePlan(user_id=uid, case_id=case_id, status='draft', autonomy_level='L1',
                            created_by='Analyst 100%_safe', actions=[]))
        db.commit()
    return owner, case_id


@pytest.mark.parametrize('sort,reverse', [('newest', True), ('oldest', False)])
def test_full_history_literal_search_filter_order_and_csv_share_scope(client, sort, reverse):
    owner, case = seed(client)
    params = {'query': '  100%_SAFE  ', 'case_id': case, 'autonomy_level': 'L2', 'status': 'completed', 'sort': sort}
    first = client.get('/api/v1/response-plans/', params={**params, 'size': 20}, headers=owner).json()
    second = client.get('/api/v1/response-plans/', params={**params, 'page': 2, 'size': 20}, headers=owner).json()
    assert first['total'] == second['total'] == 23
    assert len(first['data']) == 20 and len(second['data']) == 3
    ids = [row['id'] for row in first['data'] + second['data']]
    assert ids == sorted(ids, reverse=reverse)
    csv = _read_csv(client.get('/api/v1/response-plans/export', params=params, headers=owner))
    assert [int(row['id']) for row in csv] == ids
    assert all(row['created_by'] == 'Analyst 100%_safe' for row in csv)


def test_search_ids_creator_and_empty_scope_do_not_search_actions_or_mutate(client):
    owner, case = seed(client)
    params = {'query': str(case), 'case_id': case}
    before = client.get('/api/v1/response-plans/', params=params, headers=owner).json()
    assert before['total'] == 26
    for query in ['not-searchable-action-text', 'absent-creator']:
        assert client.get('/api/v1/response-plans/', params={'query': query}, headers=owner).json()['total'] == 0
        assert _read_csv(client.get('/api/v1/response-plans/export', params={'query': query}, headers=owner)) == []
    assert client.get('/api/v1/response-plans/', params=params, headers=owner).json() == before


@pytest.mark.parametrize('params', [{'case_id': 0}, {'autonomy_level': 'L5'}, {'sort': 'random'}, {'query': 'x' * 201}])
def test_invalid_plan_history_scope_rejected_on_list_and_export(client, params):
    owner = _register_and_login(client, 'history-invalid@example.com')
    for path in ['/api/v1/response-plans/', '/api/v1/response-plans/export']:
        assert client.get(path, params=params, headers=owner).status_code == 422
