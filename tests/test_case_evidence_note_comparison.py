"""Source comparison is an exact owner-scoped read, never an evidence update or certification."""
import pytest
from test_case_create import _TestingSessionLocal, register_and_login
from test_case_create import client as client
from test_case_evidence_notes import setup_note

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline, CaseWatcher
from backend.models.notification import Notification
from backend.models.security_event import SecurityEvent


def prepare_comparison(client, kind='event'):
    headers, case_id, record_id, path, preview, original = setup_note(client, kind)
    note = client.post(path + '/notes', headers=headers, json={
        'reviewed_fingerprint': preview['reviewed_fingerprint'], 'content': 'PRIVATE_NOTE_TEXT_NOT_IN_COMPARISON'})
    assert note.status_code == 200, note.text
    identity = note.json()['note_id']
    url = f'/api/v1/cases/{case_id}/notes/{identity}/source-comparison'
    return headers, case_id, record_id, identity, url, original


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_current_exact_source_matches_saved_revision_without_any_side_effect(client, kind):
    headers, case_id, record_id, note_id, url, original = prepare_comparison(client, kind)
    model = Alert if kind == 'alert' else SecurityEvent
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        before_case = {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns}
        counts = [db.query(cls).count() for cls in (CaseTimeline, AuditLog, CaseAlert, CaseEvent)]
        saved = db.get(CaseTimeline, note_id).metadata_json
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['case_id'] == case_id and result['note_id'] == note_id
    assert result['kind'] == kind and result['record_id'] == record_id and result['schema_version'] == 1
    assert result['source_available'] is True and result['revision_matches'] is True and result['link_count'] == 2
    assert result['changed_snapshot_fields'] == []
    assert result['saved_snapshot'] == result['current_snapshot'] == saved['record_snapshot']
    assert result['saved_fingerprint'] == result['current_fingerprint'] == saved['record_fingerprint']
    assert 'PRIVATE_NOTE_TEXT' not in response.text and 'raw_data' not in response.text
    assert 'user_id' not in response.text and '9007199254740993' not in response.text
    assert result['retrieved_at']
    with _TestingSessionLocal() as db:
        record, case = db.get(model, record_id), db.get(Case, case_id)
        assert {column.name: str(getattr(record, column.name)) for column in model.__table__.columns} == original
        assert {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns} == before_case
        assert [db.query(cls).count() for cls in (CaseTimeline, AuditLog, CaseAlert, CaseEvent)] == counts
        assert db.query(CaseWatcher).count() == 0 and db.query(Notification).count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('change', ['label', 'severity', 'processing', 'hidden'])
def test_full_revision_drift_is_distinct_from_bounded_snapshot_field_changes(client, kind, change):
    headers, _case_id, identity, _note_id, url, _ = prepare_comparison(client, kind)
    with _TestingSessionLocal() as db:
        record = db.get(Alert if kind == 'alert' else SecurityEvent, identity)
        if change == 'label':
            setattr(record, 'title' if kind == 'alert' else 'signature', 'Changed source label')
        elif change == 'severity':
            record.severity = 'low'
        elif change == 'processing':
            field = 'status' if kind == 'alert' else 'processed'
            setattr(record, field, 'pending' if getattr(record, field) != 'pending' else 'acknowledged')
        else:
            setattr(record, 'description' if kind == 'alert' else 'raw_data',
                    'PRIVATE_CHANGED_PAYLOAD' if kind == 'alert' else {'private': 'PRIVATE_CHANGED_PAYLOAD'})
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    result = response.json()
    assert result['source_available'] is True and result['revision_matches'] is False
    assert result['saved_fingerprint'] != result['current_fingerprint']
    expected = {'label': 'label_at_review', 'severity': 'severity', 'processing': 'processing_label'}
    assert result['changed_snapshot_fields'] == ([] if change == 'hidden' else [expected[change]])
    assert 'PRIVATE_CHANGED_PAYLOAD' not in response.text


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_unlinked_source_keeps_historical_reference_and_current_owned_source_readable(client, kind):
    headers, case_id, _identity, _note_id, url, _ = prepare_comparison(client, kind)
    with _TestingSessionLocal() as db:
        db.query(CaseAlert if kind == 'alert' else CaseEvent).filter_by(case_id=case_id).delete()
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    assert response.json()['source_available'] is True and response.json()['revision_matches'] is True
    assert response.json()['link_count'] == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('unavailable', ['deleted', 'transferred'])
def test_unavailable_sources_are_not_reported_as_deleted_or_inferred_private_record_state(client, kind, unavailable):
    headers, _case_id, identity, _note_id, url, _ = prepare_comparison(client, kind)
    with _TestingSessionLocal() as db:
        model = Alert if kind == 'alert' else SecurityEvent
        if unavailable == 'deleted':
            db.query(model).filter_by(id=identity).delete()
        else:
            db.get(model, identity).user_id = 999
            setattr(db.get(model, identity), 'title' if kind == 'alert' else 'signature', 'PRIVATE_FOREIGN_SOURCE')
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200 and 'PRIVATE_FOREIGN_SOURCE' not in response.text
    result = response.json()
    assert result['source_available'] is False and result['saved_snapshot']
    for key in ('current_snapshot', 'current_fingerprint', 'revision_matches', 'changed_snapshot_fields', 'link_count'):
        assert result[key] is None


def test_foreign_case_and_watchers_cannot_compare_original_source(client):
    headers, case_id, _identity, _note_id, url, _ = prepare_comparison(client)
    other = register_and_login(client, 'source-review-viewer@example.com')
    viewer = client.get('/api/v1/auth/me', headers=other).json()['id']
    assert client.get(url, headers=other).status_code == 404
    with _TestingSessionLocal() as db:
        db.add(CaseWatcher(case_id=case_id, user_id=viewer))
        db.commit()
    assert client.get(f'/api/v1/cases/{case_id}', headers=other).status_code == 200
    assert client.get(url, headers=other).status_code == 404
    client.cookies.clear()
    assert client.get(url).status_code in (401, 403)
    assert client.get(url.replace('/notes/', '/notes/999'), headers=headers).status_code == 404


@pytest.mark.parametrize('mutation', [
    {'kind': 'other'}, {'schema_version': True}, {'schema_version': 2}, {'case_id': 999},
    {'record_kind': 'private'}, {'record_id': True}, {'record_id': 9007199254740992},
    {'record_fingerprint': 'bad'}, {'reviewed_fingerprint': 'bad'}, {'record_snapshot': None},
])
def test_malformed_or_cross_case_metadata_cannot_select_a_current_record(client, mutation):
    headers, _case_id, _identity, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, **mutation}
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(note, 'metadata_json')
        db.commit()
    assert client.get(url, headers=headers).status_code == 422


def test_only_bounded_expected_snapshot_fields_are_returned_and_note_editing_does_not_recertify_source(client):
    headers, case_id, _identity, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, 'private': 'PRIVATE_METADATA', 'record_snapshot': {
            **note.metadata_json['record_snapshot'], 'payload': 'PRIVATE_NESTED_METADATA'}}
        db.commit()
    assert client.patch(f'/api/v1/cases/{case_id}/notes/{note_id}', headers=headers,
                        json={'content': 'Edited interpretation'}).status_code == 200
    response = client.get(url, headers=headers)
    assert response.status_code == 200 and response.json()['revision_matches'] is True
    assert 'PRIVATE_' not in response.text and 'Edited interpretation' not in response.text
    assert 'edited' not in response.text


@pytest.mark.parametrize('mutation', [
    {'label_at_review': 17}, {'label_at_review': 'x' * 501}, {'label_truncated': 0},
    {'severity': {}}, {'recorded_at': 'not-a-date'}, {'processing_label': []},
])
def test_invalid_saved_snapshot_fields_fail_closed(client, mutation):
    from sqlalchemy.orm.attributes import flag_modified
    headers, _case_id, _record_id, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, 'record_snapshot': {
            **note.metadata_json['record_snapshot'], **mutation}}
        flag_modified(note, 'metadata_json')
        db.commit()
    assert client.get(url, headers=headers).status_code == 422


@pytest.mark.parametrize('change', ['free_note', 'nonhuman', 'not_a_note'])
def test_unsupported_timeline_entries_cannot_be_treated_as_reviewed_evidence_notes(client, change):
    headers, _case_id, _record_id, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        if change == 'free_note':
            note.metadata_json = None
        elif change == 'nonhuman':
            note.source = 'ai'
        else:
            note.entry_type = 'action'
        db.commit()
    assert client.get(url, headers=headers).status_code == 422


def test_fingerprints_and_visible_snapshot_differences_are_independent_facts(client):
    headers, _case_id, _record_id, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, 'record_snapshot': {
            **note.metadata_json['record_snapshot'], 'severity': 'low'}}
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    assert response.json()['revision_matches'] is True
    assert response.json()['changed_snapshot_fields'] == ['severity']


def test_long_saved_and_current_labels_are_explicit_bounded_excerpts(client):
    headers, _case_id, record_id, note_id, url, _ = prepare_comparison(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, 'record_snapshot': {
            **note.metadata_json['record_snapshot'], 'label_at_review': 'S' * 500, 'label_truncated': True}}
        db.get(SecurityEvent, record_id).signature = 'N' * 1200
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    current = response.json()['current_snapshot']
    assert current['label_truncated'] is True and len(current['label_at_review']) == 500
    assert response.json()['saved_snapshot']['label_at_review'] == 'S' * 500
