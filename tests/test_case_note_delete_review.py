"""Guard timeline-note replacement against stale text, scope and metadata."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _seed_case_actor, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTimeline, CaseWatcher
from backend.models.user import User


def setup(client):
    headers = _seed_case_actor(client, 'owner@example.com')
    cid = _create_case(client, headers)
    result = client.post(f'/api/v1/cases/{cid}/notes', headers=headers, json={'content': 'Original text'})
    assert result.status_code == 201
    nid = result.json()['id']
    response = client.get(f'/api/v1/cases/{cid}/notes/{nid}/deletion-review', headers=headers)
    assert response.status_code == 200, response.text
    return headers, cid, nid, response.json()


def save(client, headers, cid, nid, preview):
    return client.delete(f'/api/v1/cases/{cid}/notes/{nid}/reviewed', headers=headers,
                         params={'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_preview_then_exact_permanent_deletion_preserves_watchers_notifications_and_receipt(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    headers, cid, nid, preview = setup(client)
    assert preview['content'] == 'DELETE TIMELINE NOTE' and preview['note']['content'] == 'Original text'
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, nid).content == 'Original text'
        db.add(CaseWatcher(case_id=cid, user_id=_user_id(client, headers)))
        db.commit()
        notifications = db.query(Notification).count()
        watches = db.query(CaseWatcher).count()
    result = save(client, headers, cid, nid, preview)
    assert result.status_code == 204, result.text
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, nid) is None
        assert db.query(Notification).count() == notifications
        assert db.query(CaseWatcher).count() == watches
        audit = db.query(AuditLog).filter_by(action='case_note_deletion_reviewed', target_id=cid).one()
        assert 'Original text' not in audit.detail
        assert db.get(Case, cid).status == 'open'
    assert save(client, headers, cid, nid, preview).status_code == 404


@pytest.mark.parametrize('change', ['content', 'metadata_json', 'source', 'user_id', 'timestamp', 'title', 'role'])
def test_changed_saved_note_case_or_actor_blocks_before_edit(client, change):
    from datetime import UTC, datetime
    headers, cid, nid, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change == 'title':
            db.get(Case, cid).title = 'Changed'
        elif change == 'role':
            db.get(User, _user_id(client, headers)).role = 'analyst'
        else:
            setattr(db.get(CaseTimeline, nid), change, {'content': 'Someone else edited',
                'metadata_json': {'changed': True}, 'source': 'agent', 'user_id': None,
                'timestamp': datetime(2020, 1, 1, tzinfo=UTC)}[change])
        db.commit()
    assert save(client, headers, cid, nid, preview).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, nid) is not None


def test_deleted_system_crosscase_and_nonowner_notes_are_not_editable(client):
    headers, cid, nid, preview = setup(client)
    other = _seed_case_actor(client, 'other@example.com')
    other_case = _create_case(client, other)
    assert client.get(f'/api/v1/cases/{cid}/notes/{nid}/deletion-review', headers=other).status_code == 404
    assert save(client, other, cid, nid, preview).status_code == 404
    assert save(client, headers, other_case, nid, preview).status_code == 404
    with _TestingSessionLocal() as db:
        db.get(CaseTimeline, nid).entry_type = 'action'
        db.commit()
    assert save(client, headers, cid, nid, preview).status_code == 422
    with _TestingSessionLocal() as db:
        db.delete(db.get(CaseTimeline, nid))
        db.commit()
    assert save(client, headers, cid, nid, preview).status_code == 404


def test_invalid_fingerprint_and_edit_fingerprint_cannot_delete(client):
    headers, cid, nid, _preview = setup(client)
    assert save(client, headers, cid, nid, {'reviewed_fingerprint': 'bad'}).status_code == 422
    other = client.post(f'/api/v1/cases/{cid}/notes/{nid}/edit-review', headers=headers,
                        json={'content': 'Other replacement'}).json()
    assert save(client, headers, cid, nid, other).status_code == 409
