"""Reviewed evidence annotations preserve source and workflow state without sharing or notifying."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_case_create import _TestingSessionLocal, register_and_login
from test_case_create import client as client
from test_case_evidence_unlink import prepare

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline, CaseWatcher
from backend.models.notification import Notification
from backend.models.organization import Organization
from backend.models.security_event import SecurityEvent
from backend.models.user import User


def setup_note(client, kind='event'):
    headers, case_id, identity, path, _old, original = prepare(client, kind, duplicates=2)
    preview = client.get(path + '/note-preview', headers=headers)
    assert preview.status_code == 200, preview.text
    return headers, case_id, identity, path, preview.json(), original


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_exact_note_keeps_all_evidence_case_links_and_records_bounded_provenance_and_audit(client, kind):
    headers, case_id, identity, path, preview, original = setup_note(client, kind)
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        original_case = {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns}
        original_links = db.query(CaseAlert).count(), db.query(CaseEvent).count()
    assert preview['note_count'] == 0 and preview['recent_notes'] == []
    payload = {'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': '  Check retained source evidence  '}
    response = client.post(path + '/notes', headers=headers, json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['created'] is True and body['content'] == 'Check retained source evidence'
    assert body['case_id'] == case_id and body['record_id'] == identity and body['kind'] == kind
    assert body['reviewed_fingerprint'] == payload['reviewed_fingerprint']
    model = Alert if kind == 'alert' else SecurityEvent
    with _TestingSessionLocal() as db:
        record, case = db.get(model, identity), db.get(Case, case_id)
        assert {column.name: str(getattr(record, column.name)) for column in model.__table__.columns} == original
        assert {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns} == original_case
        assert (db.query(CaseAlert).count(), db.query(CaseEvent).count()) == original_links
        entry = db.query(CaseTimeline).one()
        assert entry.id == body['note_id'] and entry.entry_type == 'note' and entry.source == 'human'
        assert entry.metadata_json['record_fingerprint'] == preview['record_fingerprint']
        assert entry.metadata_json['record_snapshot']['label_at_review'] == preview['record']['label']
        assert 'raw_data' not in str(entry.metadata_json) and '9007199254740993' not in str(entry.metadata_json)
        audit = db.query(AuditLog).filter_by(action='case_evidence_note_added').one()
        assert 'Check retained source evidence' not in audit.detail
        assert db.query(Notification).count() == 0 and db.query(CaseWatcher).count() == 0
    duplicate = client.post(path + '/notes', headers=headers, json=payload)
    assert duplicate.status_code == 200 and duplicate.json()['created'] is False
    assert duplicate.json()['note_id'] == body['note_id']
    fresh = client.get(path + '/note-preview', headers=headers).json()
    assert fresh['note_count'] == 1 and fresh['recent_notes'][0]['content'] == body['content']
    assert fresh['reviewed_fingerprint'] != preview['reviewed_fingerprint']
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1
        assert db.query(AuditLog).filter_by(action='case_evidence_note_added').count() == 1


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('change', ['evidence', 'case', 'unlink', 'duplicate', 'note'])
def test_stale_source_case_pair_or_note_history_blocks_a_new_annotation(client, kind, change):
    headers, case_id, identity, path, preview, _ = setup_note(client, kind)
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        if change == 'evidence':
            setattr(db.get(model, identity), 'description' if kind == 'alert' else 'raw_data',
                    'Changed hidden evidence' if kind == 'alert' else {'changed': True})
        elif change == 'case':
            db.get(Case, case_id).title = 'Changed investigation'
        elif change == 'unlink':
            db.query(link).filter_by(case_id=case_id).delete()
        elif change == 'duplicate':
            db.add(link(case_id=case_id, **{f'{kind}_id': identity}))
        else:
            owner = db.get(Case, case_id).user_id
            db.add(CaseTimeline(case_id=case_id, entry_type='note', source='human', user_id=owner,
                                content='Another evidence note', metadata_json={
                                    'kind': 'reviewed_evidence_note', 'schema_version': 1, 'case_id': case_id,
                                    'record_kind': kind, 'record_id': identity,
                                    'record_fingerprint': preview['record_fingerprint']}))
        db.commit()
    response = client.post(path + '/notes', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'New note'})
    assert response.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == (1 if change == 'note' else 0)
        assert db.query(AuditLog).filter_by(action='case_evidence_note_added').count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_anonymous_foreign_case_and_transferred_evidence_cannot_read_or_annotate(client, kind):
    headers, _case_id, identity, path, preview, _ = setup_note(client, kind)
    other = register_and_login(client, 'foreign-evidence-note@example.com')
    payload = {'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'New note'}
    assert client.get(path + '/note-preview', headers=other).status_code == 404
    assert client.post(path + '/notes', headers=other, json=payload).status_code == 404
    with _TestingSessionLocal() as db:
        db.get(Alert if kind == 'alert' else SecurityEvent, identity).user_id = 999
        db.commit()
    assert client.get(path + '/note-preview', headers=headers).status_code == 404
    assert client.post(path + '/notes', headers=headers, json=payload).status_code == 404
    client.cookies.clear()
    assert client.get(path + '/note-preview').status_code in (401, 403)
    assert client.post(path + '/notes', json=payload).status_code in (401, 403)


@pytest.mark.parametrize('body', [{}, {'content': 'Text'}, {'reviewed_fingerprint': 'bad', 'content': 'Text'},
                                 {'reviewed_fingerprint': 'a' * 64, 'content': ''},
                                 {'reviewed_fingerprint': 'a' * 64, 'content': '  '},
                                 {'reviewed_fingerprint': 'a' * 64, 'content': 'x' * 2001},
                                 {'reviewed_fingerprint': 'a' * 64, 'content': 'Text', 'notify': True}])
def test_invalid_note_does_not_change_history(client, body):
    headers, _case_id, _identity, path, _preview, _ = setup_note(client)
    assert client.post(path + '/notes', headers=headers, json=body).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_concurrent_identical_review_creates_one_note_and_audit_record(client, kind):
    headers, _case_id, _identity, path, preview, _ = setup_note(client, kind)
    def add(_):
        return client.post(path + '/notes', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'Same note'})
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(add, range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()['created'] for response in responses) == [False, True]
    assert len({response.json()['note_id'] for response in responses}) == 1
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1
        assert db.query(AuditLog).filter_by(action='case_evidence_note_added').count() == 1


def test_recent_notes_are_five_exact_pair_rows_with_an_honest_total_and_safe_label_excerpt(client):
    headers, case_id, identity, path, _preview, _ = setup_note(client, 'event')
    with _TestingSessionLocal() as db:
        db.get(SecurityEvent, identity).signature = 'L' * 700
        owner = db.get(Case, case_id).user_id
        for index in range(7):
            db.add(CaseTimeline(case_id=case_id, user_id=owner, source='human', entry_type='note',
                                content=f'Prior annotation {index}', metadata_json={
                                    'kind': 'reviewed_evidence_note', 'schema_version': 1, 'case_id': case_id,
                                    'record_kind': 'event', 'record_id': identity,
                                    'record_fingerprint': 'a' * 64}))
        db.add(CaseTimeline(case_id=case_id, source='human', entry_type='note', content='Unrelated free note'))
        db.commit()
    preview = client.get(path + '/note-preview', headers=headers).json()
    assert preview['note_count'] == 7 and len(preview['recent_notes']) == 5
    assert preview['recent_notes'][0]['content'] == 'Prior annotation 6'
    response = client.post(path + '/notes', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'Bounded source'})
    assert response.status_code == 200
    detail = client.get(f'/api/v1/cases/{case_id}', headers=headers).json()
    entry = next(row for row in detail['timeline'] if row['id'] == response.json()['note_id'])
    snapshot = entry['metadata_json']['record_snapshot']
    assert snapshot['label_truncated'] is True and len(snapshot['label_at_review']) == 500
    # A normal text edit retains the original reference, and a subsequent source unlink does not erase it.
    edited = client.patch(f"/api/v1/cases/{case_id}/notes/{entry['id']}", headers=headers,
                          json={'content': 'Edited interpretation'})
    assert edited.status_code == 200 and edited.json()['metadata_json']['edited'] is True
    assert edited.json()['metadata_json']['record_fingerprint'] == entry['metadata_json']['record_fingerprint']
    assert client.delete(f'/api/v1/cases/{case_id}/events/{identity}', headers=headers).status_code == 200
    detail = client.get(f'/api/v1/cases/{case_id}', headers=headers).json()
    saved = next(row for row in detail['timeline'] if row['id'] == entry['id'])
    assert saved['metadata_json']['record_snapshot'] == snapshot


def test_mentions_remain_plain_text_without_watcher_sharing_or_notifications(client):
    headers, case_id, _identity, path, _preview, _ = setup_note(client)
    target_headers = register_and_login(client, 'will@example.com')
    with _TestingSessionLocal() as db:
        organization = Organization(name='Evidence notes org', slug='evidence-notes-org')
        db.add(organization)
        db.flush()
        for user in db.query(User).all():
            user.org_id = organization.id
        db.commit()
    preview = client.get(path + '/note-preview', headers=headers).json()
    assert client.post(path + '/notes', headers=headers, json={
        'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': '@will is literal annotation text'}
    ).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseWatcher).filter_by(case_id=case_id).count() == 0
        assert db.query(Notification).count() == 0
    assert client.get(f'/api/v1/cases/{case_id}', headers=target_headers).status_code == 404


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_atomic_failure_rolls_back_annotation_and_audit(client, kind, monkeypatch):
    from test_case_create import _AsyncTestingSessionLocal
    headers, _case_id, _identity, path, preview, _ = setup_note(client, kind)
    commit = _AsyncTestingSessionLocal.class_.commit
    async def fail(session):
        if any(isinstance(row, AuditLog) and row.action == 'case_evidence_note_added' for row in session.new):
            raise RuntimeError('simulated annotation failure')
        return await commit(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated annotation failure'):
        client.post(path + '/notes', headers=headers,
                    json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'Atomic annotation'})
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0
        assert db.query(AuditLog).filter_by(action='case_evidence_note_added').count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_distinct_concurrent_notes_require_a_new_review_after_the_first_write(client, kind):
    headers, _case_id, _identity, path, preview, _ = setup_note(client, kind)
    def add(index):
        return client.post(path + '/notes', headers=headers, json={
            'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': f'Distinct note {index}'})
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(add, range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1
        assert db.query(AuditLog).filter_by(action='case_evidence_note_added').count() == 1


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('change', ['case_status', 'processing', 'other_link', 'label'])
def test_stale_current_fields_and_owned_relationships_require_fresh_review(client, kind, change):
    headers, case_id, identity, path, preview, _ = setup_note(client, kind)
    with _TestingSessionLocal() as db:
        record = db.get(Alert if kind == 'alert' else SecurityEvent, identity)
        if change == 'case_status':
            db.get(Case, case_id).status = 'investigating'
        elif change == 'processing':
            field = 'status' if kind == 'alert' else 'processed'
            setattr(record, field, 'pending' if getattr(record, field) != 'pending' else 'acknowledged')
        elif change == 'label':
            setattr(record, 'title' if kind == 'alert' else 'signature', 'A changed label')
        else:
            link = CaseAlert if kind == 'alert' else CaseEvent
            db.query(link).filter(link.case_id != case_id).delete()
        db.commit()
    response = client.post(path + '/notes', headers=headers, json={
        'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'Changed-state review needed'})
    assert response.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('change', ['source_changed', 'unlinked'])
def test_an_old_identical_note_is_not_a_write_bypass_after_source_or_link_changes(client, kind, change):
    headers, case_id, identity, path, preview, _ = setup_note(client, kind)
    payload = {'reviewed_fingerprint': preview['reviewed_fingerprint'],
               'content': 'Interpretation of original revision'}
    assert client.post(path + '/notes', headers=headers, json=payload).status_code == 200
    with _TestingSessionLocal() as db:
        if change == 'source_changed':
            record = db.get(Alert if kind == 'alert' else SecurityEvent, identity)
            setattr(record, 'title' if kind == 'alert' else 'signature', 'Changed source revision')
        else:
            db.query(CaseAlert if kind == 'alert' else CaseEvent).filter_by(case_id=case_id).delete()
        db.commit()
    assert client.post(path + '/notes', headers=headers, json=payload).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1


def test_history_scope_excludes_other_kind_record_case_schema_and_nonhuman_entries(client):
    headers, case_id, identity, path, _preview, _ = setup_note(client)
    with _TestingSessionLocal() as db:
        for index, mutation in enumerate([{'record_kind': 'alert'}, {'record_id': identity + 1},
                                          {'case_id': case_id + 1}, {'schema_version': 2},
                                          {'kind': 'other'}]):
            metadata = {'kind': 'reviewed_evidence_note', 'schema_version': 1, 'case_id': case_id,
                        'record_kind': 'event', 'record_id': identity, 'record_fingerprint': 'a' * 64}
            metadata.update(mutation)
            db.add(CaseTimeline(case_id=case_id, source='human', entry_type='note',
                                content=f'Unrelated annotation {index}', metadata_json=metadata))
        db.add(CaseTimeline(case_id=case_id, source='ai', entry_type='note', content='Not a human annotation',
                            metadata_json={'kind': 'reviewed_evidence_note', 'schema_version': 1, 'case_id': case_id,
                                           'record_kind': 'event', 'record_id': identity}))
        db.commit()
    response = client.get(path + '/note-preview', headers=headers)
    assert response.status_code == 200 and response.json()['note_count'] == 0
    assert response.json()['recent_notes'] == []


@pytest.mark.parametrize('identity', ['0', '-1', '1.5', '9007199254740992', 'nope'])
def test_note_routes_require_exact_positive_safe_ids(client, identity):
    headers, case_id, _identity, _path, _preview, _ = setup_note(client)
    base = f'/api/v1/cases/{case_id}/evidence/event/{identity}'
    assert client.get(base + '/note-preview', headers=headers).status_code == 422
    assert client.post(base + '/notes', headers=headers, json={
        'reviewed_fingerprint': 'a' * 64, 'content': 'No malformed identity'}).status_code == 422
