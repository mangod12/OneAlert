"""Watcher removal previews retained access and guards exact relationships."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _seed_case_actor, _share_org, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTask, CaseWatcher
from backend.models.user import User


def setup(client):
    owner = _seed_case_actor(client, 'owner@example.com')
    target = _seed_case_actor(client, 'watcher@example.com')
    oid, uid = _user_id(client, owner), _user_id(client, target)
    cid = _create_case(client, owner)
    _share_org(oid, uid)
    assert client.post(f'/api/v1/cases/{cid}/watchers', headers=owner, json={'user_id': uid}).status_code == 200
    response = client.get(f'/api/v1/cases/{cid}/watchers/{uid}/removal-review', headers=owner)
    assert response.status_code == 200, response.text
    return owner, target, cid, uid, response.json()


def save(client, headers, cid, uid, preview):
    return client.delete(f'/api/v1/cases/{cid}/watchers/{uid}/reviewed', headers=headers,
                         params={'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_preview_no_effect_then_exact_removal_revokes_watch_access_but_keeps_notifications(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    owner, target, cid, uid, preview = setup(client)
    assert preview['recipient']['email'] == 'watcher@example.com' and preview['retained_access_reasons'] == []
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200
    with _TestingSessionLocal() as db:
        notices = db.query(Notification).count()
    result = save(client, owner, cid, uid, preview)
    assert result.status_code == 204, result.text
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 404
    with _TestingSessionLocal() as db:
        assert db.query(CaseWatcher).filter_by(case_id=cid, user_id=uid).count() == 0
        assert db.query(Notification).count() == notices
        assert db.query(AuditLog).filter_by(action='case_watcher_removal_reviewed', target_id=cid).count() == 1
    assert save(client, owner, cid, uid, preview).status_code == 409


@pytest.mark.parametrize('reason', ['owner', 'assignee', 'task'])
def test_retained_owner_assignee_or_task_access_is_disclosed_and_preserved(client, reason):
    owner, target, cid, uid, _ = setup(client)
    with _TestingSessionLocal() as db:
        if reason == 'owner':
            db.get(Case, cid).user_id = uid
        elif reason == 'assignee':
            db.get(Case, cid).assigned_to_id = uid
        else:
            db.add(CaseTask(case_id=cid, title='Retained assigned task', assignee_id=uid, done=True))
        db.commit()
    actor = target if reason == 'owner' else owner
    result = client.get(f'/api/v1/cases/{cid}/watchers/{uid}/removal-review', headers=actor)
    assert result.status_code == 200
    preview = result.json()
    assert preview['retained_access_reasons']
    if reason == 'task':
        assert preview['assigned_tasks'][0]['title'] == 'Retained assigned task'
    assert save(client, actor, cid, uid, preview).status_code == 204
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200


@pytest.mark.parametrize('change', ['email', 'role', 'is_active', 'title', 'assignment', 'new_task', 'watch_recreated'])
def test_changed_identity_relationship_or_access_blocks_removal(client, change):
    owner, _target, cid, uid, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change in {'email', 'role', 'is_active'}:
            setattr(db.get(User, uid), change, {'email': 'new@example.com', 'role': 'analyst',
                                              'is_active': False}[change])
        elif change == 'title':
            db.get(Case, cid).title = 'Changed'
        elif change == 'assignment':
            db.get(Case, cid).assigned_to_id = uid
        elif change == 'new_task':
            db.add(CaseTask(case_id=cid, title='New access', assignee_id=uid))
        else:
            watch = db.query(CaseWatcher).filter_by(case_id=cid, user_id=uid).one()
            watch.id = watch.id + 100
        db.commit()
    assert save(client, owner, cid, uid, preview).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseWatcher).filter_by(case_id=cid, user_id=uid).count() == 1


def test_self_removal_allowed_but_other_watcher_and_outsider_denied(client):
    owner, target, cid, uid, _ = setup(client)
    oid = _user_id(client, owner)
    assert client.post(f'/api/v1/cases/{cid}/watchers', headers=owner, json={'user_id': oid}).status_code == 200
    assert client.get(f'/api/v1/cases/{cid}/watchers/{oid}/removal-review', headers=target).status_code == 403
    outside = _seed_case_actor(client, 'outside@example.com')
    assert client.get(f'/api/v1/cases/{cid}/watchers/{uid}/removal-review', headers=outside).status_code == 404
    preview = client.get(f'/api/v1/cases/{cid}/watchers/{uid}/removal-review', headers=target).json()
    assert save(client, target, cid, uid, preview).status_code == 204
