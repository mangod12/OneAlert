"""Validation history searches all owned saved metadata without executing anything."""
from datetime import UTC, datetime

import pytest
from test_validation_delete import TestingSessionLocal
from test_validation_delete import auth_headers as auth_headers
from test_validation_delete import client as client

from backend.models.validation import ValidationRun


def seed(client, auth_headers):
    uid = client.get('/api/v1/auth/me', headers=auth_headers).json()['id']
    with TestingSessionLocal() as db:
        for index in range(25):
            db.add(ValidationRun(user_id=uid, name=f'Saved run {index}', description='Plant 100%_safe',
                                 status='completed', mode='lab', mitre_techniques=['T1110'],
                                 created_at=datetime(2026, 11, 1, tzinfo=UTC)))
        db.add_all([
            ValidationRun(user_id=uid, name='Wildcard decoy', description='Plant 100xxsafe', mode='lab'),
            ValidationRun(user_id=uid, name='Different mode', description='Plant 100%_safe', mode='dry_run'),
            ValidationRun(user_id=999, name='Private foreign run', description='Plant 100%_safe', mode='lab'),
        ])
        db.commit()


@pytest.mark.parametrize('sort,reverse', [('newest', True), ('oldest', False)])
def test_full_search_literal_filters_pagination_and_stable_ties(client, auth_headers, sort, reverse):
    seed(client, auth_headers)
    params = {'query': '  100%_SAFE  ', 'mode': 'lab', 'status': 'completed', 'sort': sort}
    first = client.get('/api/v1/validation/runs', params=params, headers=auth_headers).json()
    second = client.get('/api/v1/validation/runs', params={**params, 'page': 2}, headers=auth_headers).json()
    assert first['total'] == second['total'] == 25
    assert len(first['data']) == 20 and len(second['data']) == 5
    ids = [row['id'] for row in first['data'] + second['data']]
    assert ids == sorted(set(ids), reverse=reverse)
    assert 'Private foreign run' not in str(first) + str(second)
    assert client.get('/api/v1/validation/runs', params={**params, 'page': 999},
                      headers=auth_headers).json()['data'] == []
    assert client.get('/api/v1/validation/runs', params=params, headers=auth_headers).json() == first


def test_name_id_search_and_empty_results_leave_existing_create_safety_unchanged(client, auth_headers):
    seed(client, auth_headers)
    path = '/api/v1/validation/runs'
    found = client.get(path, headers=auth_headers, params={'query': 'saved RUN 24'}).json()
    assert found['total'] == 1
    identity = found['data'][0]['id']
    assert any(row['id'] == identity for row in client.get(path, headers=auth_headers,
               params={'query': str(identity), 'size': 100}).json()['data'])
    assert client.get(path, headers=auth_headers, params={'query': 'absent'}).json()['total'] == 0
    assert client.post(path, headers=auth_headers, json={
        'name': 'Production must still be blocked', 'mode': 'production',
        'mitre_techniques': ['T1110'],
    }).status_code == 403


@pytest.mark.parametrize('params', [{'mode': 'invalid'}, {'sort': 'invalid'}, {'query': 'x' * 201}])
def test_invalid_history_scope_is_rejected(client, auth_headers, params):
    assert client.get('/api/v1/validation/runs', headers=auth_headers, params=params).status_code == 422
