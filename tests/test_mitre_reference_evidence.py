"""All exact technique associations stay owner-bound beyond preview limits."""
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from test_mitre_references import _register_and_login, _TestingSessionLocal
from test_mitre_references import client as client

from backend.models.case import Case
from backend.models.detection_rule import DetectionRule
from backend.models.user import User


def seed(client):
    owner = _register_and_login(client, 'mitre-evidence-owner@example.com')
    other = _register_and_login(client, 'mitre-evidence-other@example.com')
    with _TestingSessionLocal() as db:
        uid = db.execute(select(User.id).where(User.email == 'mitre-evidence-owner@example.com')).scalar_one()
        foreign = db.execute(select(User.id).where(User.email == 'mitre-evidence-other@example.com')).scalar_one()
        for index in range(25):
            techniques = ['T1190'] if index % 2 else [{'id': 'T1190'}]
            db.add(Case(user_id=uid, title=f'Gateway 100%_safe {index}', status='closed', severity='high',
                        mitre_techniques=techniques, created_at=datetime(2026, 11, 1, tzinfo=UTC)))
            db.add(DetectionRule(user_id=uid, name=f'Rule 100%_safe {index}', rule_type='sigma', rule_content='test',
                                  enabled=index % 2 == 0, mitre_techniques=techniques,
                                  created_at=datetime(2026, 11, 1, tzinfo=UTC)))
        db.add_all([
            Case(user_id=foreign, title='Private foreign case', status='open', severity='high',
                 mitre_techniques=['T1190']),
            Case(user_id=uid, title='Parent mismatch', status='open', severity='high',
                 mitre_techniques=['T1190.001']),
            DetectionRule(user_id=foreign, name='Private foreign rule', rule_type='sigma', rule_content='test',
                          enabled=True, mitre_techniques=['T1190']),
        ])
        db.commit()
    return owner, other


@pytest.mark.parametrize('kind', ['cases', 'detection_rules'])
def test_full_counts_and_stable_pages_extend_beyond_preview(client, kind):
    owner, _ = seed(client)
    path = '/api/v1/mitre/techniques/t1190/reference-evidence'
    pages = [client.get(path, headers=owner, params={'kind': kind, 'page': page}).json() for page in (1, 2, 3)]
    assert [len(data['records']) for data in pages] == [10, 10, 5]
    assert all(data['total'] == 25 and data['technique_id'] == 'T1190' for data in pages)
    assert pages[0]['counts'] == {'cases': 25, 'detection_rules': 25, 'enabled_rules': 13, 'disabled_rules': 12}
    ids = [row['id'] for data in pages for row in data['records']]
    assert len(set(ids)) == 25 and ids == sorted(ids, reverse=True)
    assert 'Private' not in str(pages) and 'Parent mismatch' not in str(pages)
    assert client.get(path, headers=owner, params={'kind': kind, 'page': 999}).json()['records'] == []


def test_search_rule_state_and_owner_counts_before_filters(client):
    owner, other = seed(client)
    path = '/api/v1/mitre/techniques/T1190/reference-evidence'
    data = client.get(path, headers=owner, params={
        'kind': 'detection_rules', 'query': ' 100%_SAFE ', 'rule_state': 'disabled', 'page': 2,
    }).json()
    assert data['total'] == 12 and len(data['records']) == 2
    assert all(row['enabled'] is False for row in data['records'])
    assert data['counts']['detection_rules'] == 25
    assert client.get(path, headers=owner, params={'query': '100xxsafe'}).json()['total'] == 0
    assert client.get(path, headers=other).json()['counts'] == {
        'cases': 1, 'detection_rules': 1, 'enabled_rules': 1, 'disabled_rules': 0,
    }
    assert client.get(path, headers=owner, params={'query': 'absent'}).json()['records'] == []
    client.cookies.clear()
    assert client.get(path).status_code in (401, 403)


@pytest.mark.parametrize('params', [{'kind': 'invalid'}, {'page': 0}, {'size': 101},
                                   {'query': 'x' * 201}, {'rule_state': 'invalid'}])
def test_invalid_reference_scope_rejected(client, params):
    owner = _register_and_login(client, 'mitre-invalid@example.com')
    assert client.get('/api/v1/mitre/techniques/T1190/reference-evidence',
                      headers=owner, params=params).status_code == 422
    assert client.get('/api/v1/mitre/techniques/UNKNOWN/reference-evidence', headers=owner).status_code == 404
