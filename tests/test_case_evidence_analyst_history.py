"""Historical note discovery is exact-source and case-owner scoped, bounded and read only."""
from copy import deepcopy

import pytest
from sqlalchemy.orm.attributes import flag_modified
from test_case_create import _TestingSessionLocal, register_and_login
from test_case_create import client as client
from test_case_evidence_note_comparison import prepare_comparison

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline, CaseWatcher
from backend.models.notification import Notification
from backend.models.security_event import SecurityEvent
from backend.models.user import User


def prepare_history(client, kind='event'):
    headers, case_id, record_id, note_id, _url, original = prepare_comparison(client, kind)
    return headers, case_id, record_id, note_id, f'/api/v1/cases/source-notes/{kind}/{record_id}', original


def copy_notes(case_id, count, *, corrupt=False, other_case=None):
    with _TestingSessionLocal() as db:
        original = db.query(CaseTimeline).filter_by(case_id=case_id).first()
        metadata = deepcopy(original.metadata_json)
        if corrupt:
            metadata['schema_version'] = 2
        if other_case is not None:
            metadata['case_id'] = other_case
        for _ in range(count):
            db.add(CaseTimeline(case_id=other_case or case_id, entry_type='note', source='human',
                                user_id=original.user_id, content='Private saved note text', metadata_json=deepcopy(metadata)))
        db.commit()


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_exact_historical_note_read_has_bounded_projection_and_no_side_effect(client, kind):
    headers, case_id, record_id, note_id, url, original = prepare_history(client, kind)
    tables = (CaseTimeline, AuditLog, CaseAlert, CaseEvent, CaseWatcher, Notification)
    with _TestingSessionLocal() as db:
        counts = [db.query(table).count() for table in tables]
        case = db.get(Case, case_id)
        before = {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns}
        note = db.get(CaseTimeline, note_id)
        note.content = 'Interpretation ' + 'x' * 800
        note.metadata_json = {**note.metadata_json, 'private': 'PRIVATE_METADATA'}
        db.get(Case, case_id).title = 'T' * 250
        db.commit()
        db.refresh(case)
        before = {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns}
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['kind'] == kind and body['record_id'] == record_id and body['schema_version'] == 1
    assert body['before'] is None and body['page_size'] == 20 and body['scan_limit'] == 100
    assert body['scanned_count'] == 1 and body['excluded_count'] == 0
    assert not body['has_more'] and body['next_before'] is None
    row, = body['records']
    assert row['note_id'] == note_id and row['case_id'] == case_id
    assert len(row['note_excerpt']) == 500 and row['note_truncated'] is True
    assert len(row['case_title']) == 200 and row['case_title_truncated'] is True
    assert set(row) == {'note_id', 'case_id', 'case_title', 'case_title_truncated', 'case_status', 'case_severity',
                        'note_timestamp', 'note_excerpt', 'note_truncated', 'saved_fingerprint', 'saved_label', 'label_truncated'}
    assert 'PRIVATE_METADATA' not in response.text and 'user_id' not in response.text and 'author' not in response.text
    with _TestingSessionLocal() as db:
        assert [db.query(table).count() for table in tables] == counts
        record = db.get(Alert if kind == 'alert' else SecurityEvent, record_id)
        assert {column.name: str(getattr(record, column.name)) for column in record.__table__.columns} == original
        current_case = db.get(Case, case_id)
        assert all(str(getattr(current_case, name)) == value for name, value in before.items())


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_owned_unlinked_historical_references_and_multiple_owned_cases_remain_discoverable(client, kind):
    headers, case_id, _record_id, _note_id, url, _ = prepare_history(client, kind)
    with _TestingSessionLocal() as db:
        owner = db.get(Case, case_id).user_id
        new_case = Case(user_id=owner, title='Second owned investigation', severity='high', status='closed')
        db.add(new_case)
        db.commit()
        new_id = new_case.id
        db.query(CaseAlert if kind == 'alert' else CaseEvent).filter_by(case_id=case_id).delete()
        db.commit()
    copy_notes(case_id, 1, other_case=new_id)
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert len(body['records']) == 2 and {row['case_id'] for row in body['records']} == {case_id, new_id}
    assert 'link_count' not in response.text and 'current_fingerprint' not in response.text


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_foreign_record_and_assignment_only_and_anonymous_cannot_discover_private_notes(client, kind):
    headers, case_id, record_id, _note_id, url, _ = prepare_history(client, kind)
    other = register_and_login(client, 'foreign-history@example.com')
    assert client.get(url, headers=other).status_code == 404
    with _TestingSessionLocal() as db:
        foreign = db.query(User).filter_by(email='foreign-history@example.com').one()
        record = db.get(Alert if kind == 'alert' else SecurityEvent, record_id)
        record.user_id = foreign.id
        if kind == 'alert':
            record.assigned_to_id = db.get(Case, case_id).user_id
        db.commit()
    assert client.get(url, headers=headers).status_code == 404
    with _TestingSessionLocal() as db:
        db.delete(db.get(Alert if kind == 'alert' else SecurityEvent, record_id))
        db.commit()
    assert client.get(url, headers=headers).status_code == 404
    client.cookies.clear()
    assert client.get(url).status_code in (401, 403)


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_current_source_owner_cannot_read_foreign_case_even_as_watcher_or_case_assignee(client, kind):
    headers, case_id, _record_id, _note_id, url, _ = prepare_history(client, kind)
    register_and_login(client, 'foreign-case-history@example.com')
    with _TestingSessionLocal() as db:
        foreign = db.query(User).filter_by(email='foreign-case-history@example.com').one()
        case = db.get(Case, case_id)
        owner = case.user_id
        case.user_id, case.assigned_to_id = foreign.id, owner
        db.add(CaseWatcher(case_id=case_id, user_id=owner))
        db.commit()
    body = client.get(url, headers=headers).json()
    assert body['records'] == [] and body['scanned_count'] == 0 and body['excluded_count'] == 0


@pytest.mark.parametrize('change', [
    {'schema_version': True}, {'schema_version': 2}, {'case_id': 9000}, {'record_id': True},
    {'record_fingerprint': 'bad'}, {'reviewed_fingerprint': 'bad'}, {'record_snapshot': None},
    {'record_snapshot': {'label_at_review': 'bad'}},
])
def test_strict_saved_reference_validation_skips_unsupported_candidates_without_reflection(client, change):
    headers, _case_id, _record_id, note_id, url, _ = prepare_history(client)
    with _TestingSessionLocal() as db:
        note = db.get(CaseTimeline, note_id)
        note.metadata_json = {**note.metadata_json, **change, 'extra': 'PRIVATE_UNKNOWN_METADATA'}
        flag_modified(note, 'metadata_json')
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['records'] == []
    assert response.json()['scanned_count'] in (0, 1)  # SQL identity prefilter may safely exclude it first.
    assert 'PRIVATE_UNKNOWN_METADATA' not in response.text


def test_keyset_pages_do_not_drop_the_first_unreturned_note_or_claim_a_full_total(client):
    headers, case_id, _record_id, _note_id, url, _ = prepare_history(client)
    copy_notes(case_id, 44)
    identities, before = [], None
    for expected in [20, 20, 5]:
        body = client.get(url, headers=headers, params={} if before is None else {'before': before}).json()
        assert body['before'] == before and len(body['records']) == expected
        assert body['scanned_count'] == expected and body['excluded_count'] == 0
        ids = [row['note_id'] for row in body['records']]
        assert ids == sorted(ids, reverse=True)
        identities.extend(ids)
        if body['has_more']:
            assert body['next_before'] == ids[-1]
        else:
            assert body['next_before'] is None
        before = body['next_before']
        assert 'total' not in body
    assert len(identities) == len(set(identities)) == 45


def test_bounded_scan_empty_supported_page_still_has_explicit_continuation(client):
    headers, case_id, _record_id, note_id, url, _ = prepare_history(client)
    copy_notes(case_id, 105, corrupt=True)
    first = client.get(url, headers=headers).json()
    assert first['records'] == [] and first['scanned_count'] == first['excluded_count'] == 100
    assert first['has_more'] is True and first['next_before'] > note_id
    second = client.get(url, headers=headers, params={'before': first['next_before']}).json()
    assert len(second['records']) == 1 and second['records'][0]['note_id'] == note_id
    assert second['scanned_count'] == 6 and second['excluded_count'] == 5 and second['has_more'] is False


@pytest.mark.parametrize('value', ['0', '-1', '1.5', '9007199254740992', 'bad'])
def test_invalid_source_id_or_cursor_is_rejected(client, value):
    headers, _case_id, _record_id, _note_id, url, _ = prepare_history(client)
    assert client.get(url, headers=headers, params={'before': value}).status_code == 422
    assert client.get(f'/api/v1/cases/source-notes/event/{value}', headers=headers).status_code == 422


def test_plain_notes_nonhuman_references_other_record_ids_and_other_kinds_are_not_discovered(client):
    headers, case_id, _record_id, note_id, url, _ = prepare_history(client)
    with _TestingSessionLocal() as db:
        original = db.get(CaseTimeline, note_id)
        for change in [{'source': 'agent'}, {'entry_type': 'analysis'}, {'metadata_json': None},
                       {'record_kind': 'alert'}, {'record_id': 'bad'}, {'record_id': [1]}, {'record_kind': ['event']}]:
            metadata = deepcopy(original.metadata_json)
            metadata.update({key: value for key, value in change.items() if key in ('record_kind', 'record_id')})
            db.add(CaseTimeline(case_id=case_id, entry_type=change.get('entry_type', 'note'),
                                source=change.get('source', 'human'), user_id=original.user_id, content='PRIVATE_OTHER',
                                metadata_json=change.get('metadata_json', metadata)))
        db.commit()
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    assert [row['note_id'] for row in response.json()['records']] == [note_id]
    assert 'PRIVATE_OTHER' not in response.text
