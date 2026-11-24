"""Exact checklist deletion preserves independent access and rejects stale reviews."""
# ruff: noqa: F401, F811
from datetime import date

import pytest
from test_case_assignment import _create_case, _seed_case_actor, _share_org, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTask, CaseWatcher
from backend.models.user import User


def setup(client):
    owner = _seed_case_actor(client, 'owner@example.com')
    target = _seed_case_actor(client, 'assigned@example.com')
    cid = _create_case(client, owner)
    oid, uid = _user_id(client, owner), _user_id(client, target)
    _share_org(oid, uid)
    with _TestingSessionLocal() as db:
        task = CaseTask(case_id=cid, title='Exact saved assigned task', assignee_id=uid, done=True,
                        due_date=date(2027, 1, 10), created_by_id=oid)
        db.add(task)
        db.commit()
        tid = task.id
    preview = client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=owner)
    assert preview.status_code == 200, preview.text
    return owner, target, cid, tid, uid, preview.json()


def save(client, owner, cid, tid, preview):
    return client.delete(f'/api/v1/cases/{cid}/tasks/{tid}/reviewed', headers=owner,
                         params={'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_exact_delete_removes_task_only_and_task_derived_access_with_audit(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    owner, target, cid, tid, _uid, preview = setup(client)
    assert preview['task']['done'] and preview['task']['due_date'] == '2027-01-10'
    assert preview['assignee']['email'] == 'assigned@example.com' and not preview['retained_access_reasons']
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200
    with _TestingSessionLocal() as db:
        notices = db.query(Notification).count()
    assert save(client, owner, cid, tid, preview).status_code == 204
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 404
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, tid) is None and db.get(Case, cid) is not None
        assert db.query(Notification).count() == notices
        assert db.query(AuditLog).filter_by(action='case_task_deletion_reviewed', target_id=cid).count() == 1
    assert save(client, owner, cid, tid, preview).status_code == 409


@pytest.mark.parametrize('reason', ['owner', 'assignee', 'watcher', 'other_task', 'unassigned'])
def test_remaining_access_and_unassigned_are_disclosed(client, reason):
    owner, target, cid, tid, uid, _preview = setup(client)
    with _TestingSessionLocal() as db:
        if reason == 'owner':
            db.get(Case, cid).user_id = uid
        elif reason == 'assignee':
            db.get(Case, cid).assigned_to_id = uid
        elif reason == 'watcher':
            db.add(CaseWatcher(case_id=cid, user_id=uid))
        elif reason == 'other_task':
            db.add(CaseTask(case_id=cid, title='Other completed task', assignee_id=uid, done=True))
        else:
            db.get(CaseTask, tid).assignee_id = None
        db.commit()
    actor = target if reason == 'owner' else owner
    preview = client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=actor).json()
    assert bool(preview['retained_access_reasons']) == (reason != 'unassigned')
    if reason == 'other_task':
        assert preview['other_assigned_tasks'][0]['done']
    assert save(client, actor, cid, tid, preview).status_code == 204
    if reason != 'unassigned':
        assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200


@pytest.mark.parametrize('change', ['title', 'done', 'due_date', 'position', 'assignment', 'email', 'is_active',
                                    'role', 'case_title', 'case_assignment', 'new_task', 'new_watch'])
def test_changed_task_account_case_or_retained_access_prevents_deletion(client, change):
    owner, _target, cid, tid, uid, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change in {'title', 'done', 'due_date', 'position', 'assignment'}:
            key = 'assignee_id' if change == 'assignment' else change
            setattr(db.get(CaseTask, tid), key, {'title': 'Changed', 'done': False,
                'due_date': None, 'position': 10, 'assignment': None}[change])
        elif change in {'email', 'is_active', 'role'}:
            setattr(db.get(User, uid), change, {'email': 'changed@example.com', 'is_active': False,
                                               'role': 'admin'}[change])
        elif change == 'case_title':
            db.get(Case, cid).title = 'Changed investigation'
        elif change == 'case_assignment':
            db.get(Case, cid).assigned_to_id = uid
        elif change == 'new_task':
            db.add(CaseTask(case_id=cid, title='New independent access', assignee_id=uid))
        else:
            db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.commit()
    assert save(client, owner, cid, tid, preview).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, tid) is not None


def test_task_assignee_cannot_delete_but_investigation_assignee_can(client):
    _owner, target, cid, tid, uid, _preview = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=target).status_code == 403
    outside = _seed_case_actor(client, 'outside@example.com')
    assert client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=outside).status_code == 404
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = uid
        db.commit()
    preview = client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=target).json()
    assert save(client, target, cid, tid, preview).status_code == 204


def test_excess_remaining_access_fails_without_partial_review(client):
    owner, _target, cid, tid, uid, _preview = setup(client)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=cid, title=f'Other {n}', assignee_id=uid) for n in range(501)])
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=owner)
    assert response.status_code == 409 and 'reviewed_fingerprint' not in response.json()
