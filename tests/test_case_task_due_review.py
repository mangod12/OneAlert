"""Conditional task wording updates retain all independent task state."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _TestingSessionLocal, client
from test_case_task_deletion_review import setup

from backend.models.case import Case, CaseTask
from backend.models.user import User


def review(client, owner, cid, tid, due_date='2027-02-11'):
    return client.post(f'/api/v1/cases/{cid}/tasks/{tid}/due-review', headers=owner, json={'due_date': due_date})


def save(client, owner, cid, tid, data, due_date='2027-02-11'):
    return client.patch(f'/api/v1/cases/{cid}/tasks/{tid}/due-reviewed', headers=owner,
                        params={'reviewed_fingerprint': data['reviewed_fingerprint']}, json={'due_date': due_date})


def test_due_date_change_preserves_task_and_resets_reminders_with_timeline(client):
    from backend.models.case import CaseTimeline
    owner, target, cid, tid, uid, _ = setup(client)
    data = review(client, owner, cid, tid).json()
    assert data['proposed_due_date'] == '2027-02-11' and data['task']['due_date'] == '2027-01-10'
    response = save(client, owner, cid, tid, data)
    assert response.status_code == 200, response.text
    assert response.json()['due_date'] == '2027-02-11' and response.json()['done']
    assert response.json()['assignee_id'] == uid and response.json()['title'] == 'Exact saved assigned task'
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, tid).due_soon_notified_at is None
        assert db.query(CaseTimeline).filter(CaseTimeline.content.contains('Task due date set')).count() == 1
    clear = review(client, target, cid, tid, None)
    assert clear.status_code == 200
    assert save(client, target, cid, tid, clear.json(), None).status_code == 200
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
    assert save(client, owner, cid, tid, data, '2027-03-12' if change == 'proposed'
                else '2027-02-11').status_code == 409


@pytest.mark.parametrize('value', ['bad', '2027-02-30', {}, True])
def test_invalid_due_date_rejected(client, value):
    owner, _target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, value).status_code == 422


def test_same_due_date_and_extra_fields_rejected(client):
    owner, _target, cid, tid, _uid, _ = setup(client)
    assert review(client, owner, cid, tid, '2027-01-10').status_code == 409
    assert client.post(f'/api/v1/cases/{cid}/tasks/{tid}/due-review', headers=owner,
                       json={'due_date': None, 'done': False}).status_code == 422


def test_task_assignee_cannot_edit_someone_elses_task_or_use_manager_routes(client):
    owner, target, cid, tid, _uid, _ = setup(client)
    with _TestingSessionLocal() as db:
        other = CaseTask(case_id=cid, title='Other work', assignee_id=None)
        db.add(other)
        db.commit()
        other_id = other.id
    assert review(client, target, cid, other_id).status_code == 403
    assert client.get(f'/api/v1/cases/{cid}/tasks/{tid}/deletion-review', headers=target).status_code == 403
    assert client.post(f'/api/v1/cases/{cid}/tasks/{tid}/title-review', headers=target,
                       json={'title': 'Not permitted'}).status_code == 403
    assert review(client, owner, cid, other_id).status_code == 200
