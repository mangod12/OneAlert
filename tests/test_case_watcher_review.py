"""Exact reviewed watcher grants, without silent sharing or identity drift."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _seed_case_actor, _share_org, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseWatcher
from backend.models.user import User


def setup(client):
    headers = _seed_case_actor(client, 'owner@example.com')
    other = _seed_case_actor(client, 'watcher@example.com')
    cid = _create_case(client, headers)
    owner, target = _user_id(client, headers), _user_id(client, other)
    _share_org(owner, target)
    result = client.get(f'/api/v1/cases/{cid}/watcher-addition-review', headers=headers, params={'user_id': target})
    assert result.status_code == 200, result.text
    return headers, other, cid, target, result.json()


def save(client, headers, cid, target, preview):
    return client.post(f'/api/v1/cases/{cid}/watcher-addition-reviewed', headers=headers, json={
        'user_id': target, 'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_exact_preview_does_not_share_apply_grants_access_receipt_and_one_notification(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    headers, other, cid, target, preview = setup(client)
    assert preview['recipient']['email'] == 'watcher@example.com'
    assert client.get(f'/api/v1/cases/{cid}', headers=other).status_code == 404
    result = save(client, headers, cid, target, preview)
    assert result.status_code == 200, result.text
    assert result.json() == {'success': True, 'case_id': cid, 'user_id': target, 'email': 'watcher@example.com',
                             'reviewed_fingerprint': preview['reviewed_fingerprint']}
    assert client.get(f'/api/v1/cases/{cid}', headers=other).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseWatcher).filter_by(case_id=cid, user_id=target).count() == 1
        assert db.query(Notification).filter_by(user_id=target, kind='case_watching').count() == 1
        assert db.query(AuditLog).filter_by(target_id=cid, action='case_watcher_addition_reviewed').count() == 1
        assert db.get(Case, cid).assigned_to_id is None
    assert save(client, headers, cid, target, preview).status_code == 409


@pytest.mark.parametrize('change', ['email', 'role', 'org_id', 'is_active', 'title', 'status', 'existing'])
def test_changed_target_case_or_watch_blocks_before_share(client, change):
    headers, _other, cid, target, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change in {'email', 'role', 'org_id', 'is_active'}:
            setattr(db.get(User, target), change, {'email': 'new@example.com', 'role': 'analyst',
                                                  'org_id': None, 'is_active': False}[change])
        elif change == 'existing':
            db.add(CaseWatcher(case_id=cid, user_id=target))
        else:
            setattr(db.get(Case, cid), change, 'Changed' if change == 'title' else 'closed')
        db.commit()
    assert save(client, headers, cid, target, preview).status_code == 409


def test_nonowner_cannot_review_or_share_and_invalid_payload_rejected(client):
    headers, other, cid, target, preview = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/watcher-addition-review', headers=other,
                      params={'user_id': target}).status_code == 404
    assert save(client, other, cid, target, preview).status_code == 404
    assert client.post(f'/api/v1/cases/{cid}/watcher-addition-reviewed', headers=headers, json={
        'user_id': str(target), 'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code == 422


def test_changed_recipient_proposal_cannot_use_old_fingerprint(client):
    headers, _other, cid, _target, preview = setup(client)
    third = _seed_case_actor(client, 'third@example.com')
    target = _user_id(client, third)
    with _TestingSessionLocal() as db:
        db.get(User, target).org_id = db.get(User, _user_id(client, headers)).org_id
        db.commit()
    assert save(client, headers, cid, target, preview).status_code == 409
