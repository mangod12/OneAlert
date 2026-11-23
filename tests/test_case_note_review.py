"""Mention previews disclose exact notification and watcher grants before saving."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _share_org, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTimeline, CaseWatcher
from backend.models.user import User


def setup(client, content='Investigating @recipient and @missing'):
    owner = _register_and_login(client, 'owner@example.com')
    recipient = _register_and_login(client, 'recipient@example.com')
    cid = _create_case(client, owner)
    oid, uid = _user_id(client, owner), _user_id(client, recipient)
    _share_org(oid, uid)
    response = client.post(f'/api/v1/cases/{cid}/note-review', headers=owner, json={'content': content})
    assert response.status_code == 200, response.text
    return owner, recipient, cid, uid, response.json()


def save(client, headers, cid, preview, **overrides):
    return client.post(f'/api/v1/cases/{cid}/notes-reviewed', headers=headers, json={
        'content': preview['content'], 'reviewed_fingerprint': preview['reviewed_fingerprint'], **overrides})


def test_preview_has_no_side_effects_then_exact_note_shares_and_notifies(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    owner, recipient, cid, uid, preview = setup(client)
    assert preview['recipients'] == [{'id': uid, 'email': 'recipient@example.com',
                                      'full_name': 'User recipient', 'adds_watcher': True}]
    assert preview['unnotified_tokens'] == ['missing']
    assert 'webhook' not in str(preview) and 'notification_settings' not in preview
    assert client.get(f'/api/v1/cases/{cid}', headers=recipient).status_code == 404
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).filter_by(case_id=cid, entry_type='note', content=preview['content']).count() == 0
    result = save(client, owner, cid, preview)
    assert result.status_code == 200, result.text
    assert result.json()['content'] == preview['content'] and result.json()['note_id'] > 0
    assert client.get(f'/api/v1/cases/{cid}', headers=recipient).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseWatcher).filter_by(case_id=cid, user_id=uid).count() == 1
        assert db.query(Notification).filter_by(user_id=uid, kind='case_mention').count() == 1
        assert db.query(AuditLog).filter_by(target_id=cid, action='case_note_addition_reviewed').count() == 1
        assert db.get(Case, cid).status == 'open'


@pytest.mark.parametrize('change', ['email', 'is_active', 'org_id', 'webhook_url', 'quiet_hours_start',
                                    'title', 'assigned_to_id', 'watcher'])
def test_changed_identity_access_preferences_or_case_prevents_write(client, change):
    owner, _recipient, cid, uid, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change in {'email', 'is_active', 'org_id', 'webhook_url', 'quiet_hours_start'}:
            setattr(db.get(User, uid), change, {'email': 'different@example.com', 'is_active': False, 'org_id': None,
                                              'webhook_url': 'https://example.invalid/private',
                                              'quiet_hours_start': '22:00'}[change])
        elif change == 'watcher':
            db.add(CaseWatcher(case_id=cid, user_id=uid))
        else:
            setattr(db.get(Case, cid), change, 'Changed title' if change == 'title' else uid)
        db.commit()
    assert save(client, owner, cid, preview).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).filter_by(case_id=cid, entry_type='note', content=preview['content']).count() == 0


def test_watcher_cannot_use_mentions_to_share_with_new_people(client):
    _owner, watcher, cid, uid, _ = setup(client)
    third = _register_and_login(client, 'third@example.com')
    tid = _user_id(client, third)
    with _TestingSessionLocal() as db:
        db.get(User, tid).org_id = db.get(User, uid).org_id
        db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.commit()
    result = client.post(f'/api/v1/cases/{cid}/note-review', headers=watcher, json={'content': '@third @owner'})
    assert result.status_code == 200
    preview = result.json()
    assert preview['unnotified_tokens'] == ['third']
    assert preview['recipients'][0]['email'] == 'owner@example.com' and not preview['recipients'][0]['adds_watcher']
    assert save(client, watcher, cid, preview).status_code == 200
    assert client.get(f'/api/v1/cases/{cid}', headers=third).status_code == 404


def test_new_matching_member_and_changed_text_invalidate_review(client):
    owner, _, cid, uid, preview = setup(client)
    third = _register_and_login(client, 'missing@example.com')
    tid = _user_id(client, third)
    with _TestingSessionLocal() as db:
        db.get(User, tid).org_id = db.get(User, uid).org_id
        db.commit()
    assert save(client, owner, cid, preview).status_code == 409
    assert save(client, owner, cid, preview, content='Different note').status_code == 409


def test_unrelated_cannot_preview_save_blank_extra_and_wrong_type_rejected(client):
    owner, recipient, cid, _, preview = setup(client, ' Plain note ')
    assert preview['content'] == 'Plain note' and preview['recipients'] == []
    assert client.post(f'/api/v1/cases/{cid}/note-review', headers=recipient, json={'content': 'x'}).status_code == 404
    assert save(client, recipient, cid, preview).status_code == 404
    for body in [{'content': ' '}, {'content': 123}, {'content': 'x', 'extra': True}]:
        assert client.post(f'/api/v1/cases/{cid}/note-review', headers=owner, json=body).status_code == 422
    assert save(client, owner, cid, preview).status_code == 200
