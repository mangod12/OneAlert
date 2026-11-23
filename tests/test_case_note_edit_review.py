"""Guard timeline-note replacement against stale text, scope and metadata."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTimeline, CaseWatcher
from backend.models.user import User


def setup(client):
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    result = client.post(f'/api/v1/cases/{cid}/notes', headers=headers, json={'content': 'Original text'})
    assert result.status_code == 201
    nid = result.json()['id']
    response = client.post(f'/api/v1/cases/{cid}/notes/{nid}/edit-review', headers=headers,
                           json={'content': ' Revised @someone '})
    assert response.status_code == 200, response.text
    return headers, cid, nid, response.json()


def save(client, headers, cid, nid, preview, **overrides):
    return client.post(f'/api/v1/cases/{cid}/notes/{nid}/edit-reviewed', headers=headers, json={
        'content': preview['content'], 'reviewed_fingerprint': preview['reviewed_fingerprint'], **overrides})


def test_read_only_exact_preview_then_replaces_without_notifications_or_access_changes(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    headers, cid, nid, preview = setup(client)
    assert preview['content'] == 'Revised @someone' and preview['note']['content'] == 'Original text'
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, nid).content == 'Original text'
        before_notifications = db.query(Notification).count()
        before_watches = db.query(CaseWatcher).count()
    result = save(client, headers, cid, nid, preview)
    assert result.status_code == 200, result.text
    assert result.json() == {'success': True, 'case_id': cid, 'note_id': nid, 'content': preview['content'],
                             'reviewed_fingerprint': preview['reviewed_fingerprint']}
    with _TestingSessionLocal() as db:
        assert db.get(CaseTimeline, nid).content == preview['content']
        assert db.get(CaseTimeline, nid).metadata_json['edited'] is True
        assert db.query(Notification).count() == before_notifications
        assert db.query(CaseWatcher).count() == before_watches
        assert db.query(AuditLog).filter_by(action='case_note_edit_reviewed', target_id=cid).count() == 1
    assert save(client, headers, cid, nid, preview).status_code == 409


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
        assert db.get(CaseTimeline, nid).content != preview['content']


def test_deleted_system_crosscase_and_nonowner_notes_are_not_editable(client):
    headers, cid, nid, preview = setup(client)
    other = _register_and_login(client, 'other@example.com')
    other_case = _create_case(client, other)
    assert client.post(f'/api/v1/cases/{cid}/notes/{nid}/edit-review', headers=other,
                       json={'content': 'x'}).status_code == 404
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


def test_changed_proposal_blank_and_extra_fields_fail_closed(client):
    headers, cid, nid, preview = setup(client)
    assert save(client, headers, cid, nid, preview, content='Other text').status_code == 409
    for content in [' ', 123]:
        assert client.post(f'/api/v1/cases/{cid}/notes/{nid}/edit-review', headers=headers,
                           json={'content': content}).status_code == 422
    assert save(client, headers, cid, nid, preview, extra=True).status_code == 422
