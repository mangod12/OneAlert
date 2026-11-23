"""Owner-scoped saved investigation change receipts, never an inferred complete history."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, _user_id, client

from backend.models.audit_log import AuditLog
from backend.models.case import Case


def setup(client):
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    owner = _user_id(client, headers)
    return headers, cid, owner


def test_exact_receipts_pagination_filter_and_scope(client):
    headers, cid, owner = setup(client)
    other_headers = _register_and_login(client, 'other@example.com')
    other = _user_id(client, other_headers)
    with _TestingSessionLocal() as db:
        for i in range(13):
            db.add(AuditLog(user_id=owner, target_type='case', target_id=cid,
                            action='case_priority_reviewed' if i % 2 else 'case_assignment_reviewed',
                            detail=f'Saved {i}'))
        db.add_all([AuditLog(user_id=other, target_type='case', target_id=cid, action='PRIVATE_ACTOR'),
                    AuditLog(user_id=owner, target_type='alert', target_id=cid, action='PRIVATE_TYPE'),
                    AuditLog(user_id=owner, target_type='case', target_id=cid + 1, action='PRIVATE_TARGET')])
        db.commit()
    result = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers).json()
    assert result['case_id'] == cid and result['page'] == 1 and result['size'] == 10
    assert result['total'] == 14 and len(result['records']) == 10
    assert all(row['actor_id'] == owner and 'PRIVATE' not in row['action'] for row in result['records'])
    page2 = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params={'page': 2}).json()
    assert len(page2['records']) == 4
    assert not {row['id'] for row in result['records']} & {row['id'] for row in page2['records']}
    priority = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers,
                          params={'category': 'priority'}).json()
    assert priority['total'] == 6
    assert all(row['action'] == 'case_priority_reviewed' for row in priority['records'])


def test_nonowner_and_assignee_cannot_read_owner_receipts(client):
    _, cid, _owner = setup(client)
    other_headers = _register_and_login(client, 'other@example.com')
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = _user_id(client, other_headers)
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}/change-receipts', headers=other_headers).status_code == 404


@pytest.mark.parametrize('params', [{'page': 0}, {'size': 0}, {'size': 51}, {'category': 'private'}])
def test_invalid_scope_rejected(client, params):
    headers, cid, _ = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params=params).status_code == 422


def test_empty_receipts_are_readonly(client):
    headers, cid, _ = setup(client)
    before = client.get(f'/api/v1/cases/{cid}', headers=headers).json()
    result = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers,
                        params={'category': 'priority'}).json()
    assert result['records'] == [] and result['total'] == 0
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).json() == before
