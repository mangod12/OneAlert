"""Conditional task completion updates retain independent task state and access."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _TestingSessionLocal, client
from test_case_task_deletion_review import setup

from backend.models.case import Case, CaseTask
from backend.models.user import User


def review(client, owner, cid, tid, done=False):
    return client.post(f'/api/v1/cases/{cid}/tasks/{tid}/completion-review', headers=owner, json={'done': done})


def save(client, owner, cid, tid, data, done=False):
    return client.patch(f'/api/v1/cases/{cid}/tasks/{tid}/completion-reviewed', headers=owner,
                        params={'reviewed_fingerprint': data['reviewed_fingerprint']}, json={'done': done})


def test_completion_and_reopening_preserve_task_due_assignment_and_visibility(client):
    from backend.models.case import CaseTimeline
    owner, target, cid, tid, uid, _ = setup(client)
    data = review(client, owner, cid, tid).json()
    assert not data['proposed_done'] and data['task']['done']
    response = save(client, owner, cid, tid, data)
    assert response.status_code == 200, response.text
    task = response.json()
    assert not task['done'] and task['completed_at'] is None
    assert task['assignee_id'] == uid and task['due_date'] == '2027-01-10'
    again = review(client, target, cid, tid, True)
    assert again.status_code == 200
    result = save(client, target, cid, tid, again.json(), True)
    assert result.status_code == 200 and result.json()['done'] and result.json()['completed_at']
    assert client.get(f'/api/v1/cases/{cid}', headers=target).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).filter(CaseTimeline.content.contains('Task completed')).count() == 1
        assert db.query(CaseTimeline).filter(CaseTimeline.content.contains('Task reopened')).count() == 1
    assert save(client, owner, cid, tid, data).status_code == 409


@pytest.mark.parametrize('change', ['title', 'done', 'due_date', 'assignee', 'email', 'case_title', 'proposed'])
def test_changed_saved_task_case_identity_or_proposal_blocks_update(client, change):
    owner, _target, cid, tid, uid, _ = setup(client)
    data = review(client, owner, cid, tid).json()
    with _TestingSessionLocal() as db:
        if change in {'title', 'done', 'due_date', 'assignee'}:
            key = 'assignee_id' if change == 'assignee' else change
            setattr(db.get(CaseTask, tid), key, {'title': 'Changed', 'done': False,
                                              'due_date': None, 'assignee': None}[change])
        elif change == 'email':
            db.get(User, uid).email = 'changed@example.com'
        elif change == 'case_title':
            db.get(Case, cid).title = 'Changed'
        db.commit()
    assert save(client, owner, cid, tid, data, change == 'proposed').status_code == 409


@pytest.mark.parametrize('value', ['true', 1, None, {}])
def test_invalid_completion_rejected(client, value):
    owner, _target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, value).status_code == 422


def test_noop_extra_fields_and_other_task_assignment_rejected(client):
    owner, target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, True).status_code == 409
    assert client.post(f'/api/v1/cases/{cid}/tasks/{tid}/completion-review', headers=owner,
                       json={'done': False, 'title': 'Changed'}).status_code == 422
    with _TestingSessionLocal() as db:
        other = CaseTask(case_id=cid, title='Other work', assignee_id=None)
        db.add(other)
        db.commit()
        other_id = other.id
    assert review(client, target, cid, other_id).status_code == 403
