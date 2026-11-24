"""Exact task assignment review includes new access, notices and retained access."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _seed_case_actor, _share_org, _TestingSessionLocal, _user_id, client
from test_case_task_deletion_review import setup

from backend.models.case import CaseTask, CaseWatcher
from backend.models.user import User


def review(client, owner, cid, tid, target):
    return client.post(f'/api/v1/cases/{cid}/tasks/{tid}/assignment-review', headers=owner,
                       json={'assignee_id': target})


def save(client, owner, cid, tid, data, target):
    return client.patch(f'/api/v1/cases/{cid}/tasks/{tid}/assignment-reviewed', headers=owner,
                        params={'reviewed_fingerprint': data['reviewed_fingerprint']}, json={'assignee_id': target})


def test_unassignment_removes_only_task_access_and_preserves_completion_due(client):
    owner, target, cid, tid, _uid, _ = setup(client)
    data = review(client, owner, cid, tid, None).json()
    assert not data['assignment_notification'] and not data['grants_investigation_access']
    assert not data['retained_access_reasons']
    result = save(client, owner, cid, tid, data, None)
    assert result.status_code == 200, result.text
    assert result.json()['done'] and result.json()['due_date'] == '2027-01-10'
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 404
    assert save(client, owner, cid, tid, data, None).status_code == 409


def test_replacement_grants_new_account_access_and_notifies_without_erasing_retained_access(client):
    from backend.models.notification import Notification
    owner, old, cid, tid, uid, data = setup(client)
    new = _seed_case_actor(client, 'new@example.com')
    nid = _user_id(client, new)
    with _TestingSessionLocal() as db:
        db.get(User, nid).org_id = db.get(User, uid).org_id
        db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.commit()
    data = review(client, owner, cid, tid, nid).json()
    assert data['grants_investigation_access'] and data['assignment_notification']
    assert data['retained_access_reasons'] == ['Watcher']
    assert data['proposed_assignee']['email'] == 'new@example.com'
    result = save(client, owner, cid, tid, data, nid)
    assert result.status_code == 200, result.text
    assert client.get(f'/api/v1/cases/{cid}', headers=new).status_code == 200
    assert client.get(f'/api/v1/cases/{cid}', headers=old).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(Notification).filter_by(user_id=nid, kind='case_task_assigned').count() == 1


@pytest.mark.parametrize('change', ['target_name', 'target_settings', 'former_inactive', 'task', 'watcher'])
def test_stale_target_context_or_saved_task_blocks_assignment(client, change):
    owner, _target, cid, tid, uid, original = setup(client)
    oid = original['owner_id']
    data = review(client, owner, cid, tid, oid).json()
    with _TestingSessionLocal() as db:
        if change == 'target_name':
            db.get(User, oid).full_name = 'Changed target name'
        elif change == 'target_settings':
            db.get(User, oid).muted_kinds = ['case_task_assigned']
        elif change == 'former_inactive':
            db.get(User, uid).is_active = False
        elif change == 'task':
            db.get(CaseTask, tid).title = 'Changed'
        else:
            db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.commit()
    assert save(client, owner, cid, tid, data, oid).status_code == 409


def test_target_existing_access_and_self_assignment_without_notification(client):
    owner, _target, cid, tid, _uid, original = setup(client)
    data = review(client, owner, cid, tid, original['owner_id']).json()
    assert not data['grants_investigation_access'] and not data['assignment_notification']
    assert data['target_existing_access_reasons'] == ['Investigation owner']


@pytest.mark.parametrize('value', [True, 0, -1, '1', {}])
def test_invalid_target_rejected(client, value):
    owner, _target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, value).status_code == 422


def test_nonmanager_noop_and_cross_org_target_rejected(client):
    owner, target, cid, tid, uid, _ = setup(client)
    assert review(client, target, cid, tid, None).status_code == 403
    assert review(client, owner, cid, tid, uid).status_code == 409
    other = _seed_case_actor(client, 'outside@example.com')
    assert review(client, owner, cid, tid, _user_id(client, other)).status_code == 400
