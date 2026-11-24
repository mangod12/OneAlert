"""Reviewed assignment binds the exact case and active same-organization recipient."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import (
    _create_case,
    _seed_case_actor,
    _share_org,
    _TestingSessionLocal,
    _user_id,
    client,
)

from backend.models.audit_log import AuditLog
from backend.models.case import Case
from backend.models.notification import Notification
from backend.models.user import User


def setup(client):
    headers = _seed_case_actor(client, 'owner@example.com')
    other = _seed_case_actor(client, 'recipient@example.com')
    owner, target = _user_id(client, headers), _user_id(client, other)
    _share_org(owner, target)
    cid = _create_case(client, headers)
    response = client.get(f'/api/v1/cases/{cid}/assignment-review', headers=headers, params={'target_id': target})
    assert response.status_code == 200, response.text
    return headers, other, cid, owner, target, response.json()


def save(client, headers, cid, target, preview):
    return client.post(f'/api/v1/cases/{cid}/assign-reviewed', headers=headers,
                       json={'user_id': target, 'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_readonly_review_then_exact_assignment_and_audit(client):
    headers, _, cid, _, target, preview = setup(client)
    assert preview['current_assignee_id'] is None and preview['target']['email'] == 'recipient@example.com'
    with _TestingSessionLocal() as db:
        assert db.get(Case, cid).assigned_to_id is None
        assert db.query(Notification).count() == 0
    response = save(client, headers, cid, target, preview)
    assert response.status_code == 200, response.text
    assert response.json() == {'success': True, 'case_id': cid, 'assigned_to_id': target,
                               'assigned_to_email': 'recipient@example.com',
                               'reviewed_fingerprint': preview['reviewed_fingerprint']}
    with _TestingSessionLocal() as db:
        assert db.get(Case, cid).assigned_to_id == target
        assert db.query(Notification).filter_by(user_id=target, kind='case_assigned').count() == 1
        log = db.query(AuditLog).filter_by(action='case_assignment_reviewed').one()
        assert preview['reviewed_fingerprint'] in log.detail
    assert save(client, headers, cid, target, preview).status_code == 409


@pytest.mark.parametrize('change', ['title', 'summary', 'status', 'severity', 'assignment', 'email', 'role',
                                   'inactive', 'org', 'owner_org'])
def test_changed_case_or_recipient_never_assigns_or_notifies(client, change):
    headers, _, cid, owner, target, preview = setup(client)
    with _TestingSessionLocal() as db:
        case, recipient = db.get(Case, cid), db.get(User, target)
        if change in {'title', 'summary', 'status', 'severity'}:
            setattr(case, change, 'changed')
        elif change == 'assignment':
            case.assigned_to_id = owner
        elif change == 'email':
            recipient.email = 'changed@example.com'
        elif change == 'role':
            recipient.role = 'admin'
        elif change == 'inactive':
            recipient.is_active = False
        elif change == 'org':
            recipient.org_id = None
        elif change == 'owner_org':
            db.get(User, owner).org_id = None
        db.commit()
    assert save(client, headers, cid, target, preview).status_code in {400, 409}
    with _TestingSessionLocal() as db:
        assert db.get(Case, cid).assigned_to_id != target
        assert db.query(Notification).count() == 0


def test_unassignment_reviews_current_recipient_and_does_not_notify(client):
    headers, _, cid, _, target, preview = setup(client)
    assert save(client, headers, cid, target, preview).status_code == 200
    review = client.get(f'/api/v1/cases/{cid}/assignment-review', headers=headers).json()
    assert review['target'] is None and review['current_assignee']['id'] == target
    response = save(client, headers, cid, None, review)
    assert response.status_code == 200 and response.json()['assigned_to_id'] is None
    with _TestingSessionLocal() as db:
        assert db.query(Notification).count() == 1


def test_owner_only_and_target_id_cannot_be_swapped(client):
    headers, other, cid, owner, target, preview = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/assignment-review', headers=other,
                      params={'target_id': owner}).status_code == 404
    assert save(client, other, cid, target, preview).status_code == 404
    assert save(client, headers, cid, owner, preview).status_code == 409


@pytest.mark.parametrize('body', [{}, {'user_id': 1}, {'user_id': True, 'reviewed_fingerprint': 'f' * 64},
    {'user_id': '1', 'reviewed_fingerprint': 'f' * 64}, {'user_id': None, 'reviewed_fingerprint': 'bad'},
    {'user_id': 1, 'reviewed_fingerprint': 'f' * 64, 'notify': False}])
def test_strict_payload(client, body):
    headers = _seed_case_actor(client, 'owner@example.com')
    assert client.post('/api/v1/cases/1/assign-reviewed', headers=headers, json=body).status_code == 422
