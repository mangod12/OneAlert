"""Conditional task wording updates retain all independent task state."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _TestingSessionLocal, client
from test_case_task_deletion_review import setup

from backend.models.case import Case, CaseTask
from backend.models.user import User


def review(client, owner, cid, tid, title='Reviewed replacement title'):
    return client.post(f'/api/v1/cases/{cid}/tasks/{tid}/title-review', headers=owner, json={'title': title})


def save(client, owner, cid, tid, data, title='Reviewed replacement title'):
    return client.patch(f'/api/v1/cases/{cid}/tasks/{tid}/title-reviewed', headers=owner,
                        params={'reviewed_fingerprint': data['reviewed_fingerprint']}, json={'title': title})


def test_exact_title_change_has_no_preview_effect_preserves_state_and_audits(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    owner, _target, cid, tid, uid, _ = setup(client)
    with _TestingSessionLocal() as db:
        notices = db.query(Notification).count()
    result = review(client, owner, cid, tid)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['task']['title'] == 'Exact saved assigned task'
    assert data['proposed_title'] == 'Reviewed replacement title'
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, tid).title == 'Exact saved assigned task'
    response = save(client, owner, cid, tid, data)
    assert response.status_code == 200, response.text
    task = response.json()
    assert task['title'] == 'Reviewed replacement title' and task['done'] and task['assignee_id'] == uid
    assert task['due_date'] == '2027-01-10'
    with _TestingSessionLocal() as db:
        assert db.query(Notification).count() == notices
        assert db.query(AuditLog).filter_by(action='case_task_title_reviewed', target_id=cid).count() == 1
    assert save(client, owner, cid, tid, data).status_code == 409


@pytest.mark.parametrize('change', ['title', 'done', 'due_date', 'assignee', 'email', 'case_title', 'proposed'])
def test_changed_saved_task_case_recipient_or_proposal_blocks_update(client, change):
    owner, _target, cid, tid, uid, _ = setup(client)
    data = review(client, owner, cid, tid).json()
    with _TestingSessionLocal() as db:
        if change in {'title', 'done', 'due_date', 'assignee'}:
            key = 'assignee_id' if change == 'assignee' else change
            setattr(db.get(CaseTask, tid), key, {'title': 'Changed elsewhere', 'done': False,
                                              'due_date': None, 'assignee': None}[change])
        elif change == 'email':
            db.get(User, uid).email = 'changed@example.com'
        elif change == 'case_title':
            db.get(Case, cid).title = 'Changed context'
        db.commit()
    response = save(client, owner, cid, tid, data, 'Different proposal' if change == 'proposed'
                    else 'Reviewed replacement title')
    assert response.status_code == 409


@pytest.mark.parametrize('title', ['', '   ', 'x' * 301, 42])
def test_invalid_proposal_rejected(client, title):
    owner, _target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, title).status_code == 422


def test_same_title_and_extra_fields_rejected_and_only_manager_allowed(client):
    owner, target, cid, tid, uid, _ = setup(client)
    assert review(client, owner, cid, tid, 'Exact saved assigned task').status_code == 409
    assert client.post(f'/api/v1/cases/{cid}/tasks/{tid}/title-review', headers=owner,
                       json={'title': 'New', 'done': False}).status_code == 422
    assert review(client, target, cid, tid).status_code == 403
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = uid
        db.commit()
    data = review(client, target, cid, tid, ' New wording ').json()
    assert data['proposed_title'] == 'New wording'
    assert save(client, target, cid, tid, data, ' New wording ').status_code == 200
