"""Exact task additions preserve existing checklist state and reject stale reviews."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _TestingSessionLocal, client
from test_case_task_deletion_review import setup

from backend.models.case import Case, CaseTask
from backend.models.user import User


def review(client, owner, cid, title='New exact task'):
    return client.post(f'/api/v1/cases/{cid}/tasks/creation-review', headers=owner, json={'title': title})


def save(client, owner, cid, data, title='New exact task'):
    return client.post(f'/api/v1/cases/{cid}/tasks/creation-reviewed', headers=owner,
                      params={'reviewed_fingerprint': data['reviewed_fingerprint']}, json={'title': title})


def test_adds_one_unassigned_open_task_without_notification_or_access_change(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    owner, target, cid, tid, _uid, _ = setup(client)
    data = review(client, owner, cid).json()
    assert data['task_count'] == 1 and data['proposed_title'] == 'New exact task'
    with _TestingSessionLocal() as db:
        notices = db.query(Notification).count()
    result = save(client, owner, cid, data)
    assert result.status_code == 201, result.text
    task = result.json()
    assert task['title'] == 'New exact task' and not task['done']
    assert task['due_date'] is None and task['assignee_id'] is None and task['completed_at'] is None
    assert task['position'] == data['next_position'] and task['id'] != tid
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, tid).done
        assert db.query(Notification).count() == notices
        assert db.query(AuditLog).filter_by(action='case_task_creation_reviewed').count() == 1
    assert save(client, owner, cid, data).status_code == 409


@pytest.mark.parametrize('change', ['task_title', 'task_done', 'new_task', 'case_title', 'account', 'proposal'])
def test_changed_checklist_account_case_or_proposal_blocks_creation(client, change):
    owner, _target, cid, tid, _uid, _ = setup(client)
    data = review(client, owner, cid).json()
    with _TestingSessionLocal() as db:
        if change == 'task_title':
            db.get(CaseTask, tid).title = 'Changed'
        elif change == 'task_done':
            db.get(CaseTask, tid).done = False
        elif change == 'new_task':
            db.add(CaseTask(case_id=cid, title='Concurrent new task'))
        elif change == 'case_title':
            db.get(Case, cid).title = 'Changed'
        elif change == 'account':
            db.get(User, data['owner_id']).role = 'admin'
        db.commit()
    assert save(client, owner, cid, data, 'Different' if change == 'proposal' else 'New exact task').status_code == 409


@pytest.mark.parametrize('title', ['', '   ', 'x' * 301, 1, None])
def test_invalid_title_rejected(client, title):
    owner, _target, cid, _tid, _uid, _ = setup(client)
    assert review(client, owner, cid, title).status_code == 422


def test_task_only_assignee_cannot_create_and_extra_fields_rejected(client):
    owner, target, cid, _tid, _uid, _ = setup(client)
    assert review(client, target, cid).status_code == 403
    assert client.post(f'/api/v1/cases/{cid}/tasks/creation-review', headers=owner,
                       json={'title': 'New', 'assignee_id': 1}).status_code == 422


def test_checklist_manager_assignee_and_whitespace_normalization(client):
    _owner, target, cid, _tid, uid, _ = setup(client)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = uid
        db.commit()
    data = review(client, target, cid, '  New exact task  ').json()
    assert data['proposed_title'] == 'New exact task'
    assert save(client, target, cid, data, '  New exact task  ').status_code == 201
