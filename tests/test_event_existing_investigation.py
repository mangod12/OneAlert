"""Exact saved-event to existing-investigation review and atomic linking."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent


def prepare(client, **case_fields):
    headers = _register_and_login(client, 'existing-link-owner@example.com')
    event_id = _make_event(client, headers, signature='Recorded gateway evidence',
                           raw_data={'counter': 9007199254740993})
    with _TestingSessionLocal() as db:
        owner = db.get(SecurityEvent, event_id).user_id
        case = Case(user_id=owner, title='Existing investigation', summary='Recorded summary',
                    severity='high', status='open', **case_fields)
        db.add(case)
        db.commit()
        case_id = case.id
    path = f'/api/v1/events/{event_id}/existing-investigations/{case_id}'
    preview = client.get(path + '/preview', headers=headers)
    assert preview.status_code == 200, preview.text
    return headers, event_id, case_id, path, preview.json()


def test_preview_read_only_then_link_is_one_audited_transaction(client):
    headers, event_id, case_id, path, preview = prepare(client)
    assert preview['event']['id'] == event_id and preview['case']['id'] == case_id
    assert preview['case']['summary'] == 'Recorded summary' and preview['already_linked'] is False
    assert '9007199254740993' not in str(preview) and len(preview['event_fingerprint']) == 64
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 0
        assert db.get(SecurityEvent, event_id).processed == 'pending'
    body = {'reviewed_fingerprint': preview['reviewed_fingerprint']}
    response = client.post(path, headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json() == dict(body, event_id=event_id, case_id=case_id, linked=True, created=True)
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 1
        assert db.get(SecurityEvent, event_id).processed == 'in_case'
        assert db.query(AuditLog).filter_by(action='case_event_linked', target_id=case_id).count() == 1
        assert db.get(Case, case_id).status == 'open'
    # Lost responses cannot lead to a blind duplicate write with the old review.
    assert client.post(path, headers=headers, json=body).status_code == 409
    fresh = client.get(path + '/preview', headers=headers).json()
    assert fresh['already_linked'] is True
    noop = client.post(path, headers=headers, json={'reviewed_fingerprint': fresh['reviewed_fingerprint']})
    assert noop.status_code == 200 and noop.json()['created'] is False
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('changed', ['signature', 'raw', 'processed', 'title', 'summary', 'status', 'severity',
                                     'due_date', 'assigned_to_id', 'closed_at', 'link'])
def test_stale_event_case_or_relationship_rejects_without_write(client, changed):
    from datetime import UTC, date, datetime
    headers, event_id, case_id, path, preview = prepare(client)
    with _TestingSessionLocal() as db:
        event, case = db.get(SecurityEvent, event_id), db.get(Case, case_id)
        if changed == 'signature':
            event.signature = 'Changed'
        elif changed == 'raw':
            event.raw_data = {'counter': 9007199254740994}
        elif changed == 'processed':
            event.processed = 'processed'
        elif changed == 'link':
            db.add(CaseEvent(case_id=case_id, event_id=event_id))
        else:
            setattr(case, changed, {'due_date': date(2027, 1, 1), 'assigned_to_id': 999,
                                   'closed_at': datetime(2026, 1, 1, tzinfo=UTC)}.get(changed, 'changed'))
        db.commit()
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0
        assert db.query(CaseEvent).count() == int(changed == 'link')
        assert db.query(AuditLog).filter_by(action='case_event_linked').count() == 0


def test_both_records_must_be_owned_without_foreign_details_or_counts(client):
    headers, event_id, case_id, path, preview = prepare(client)
    other = _register_and_login(client, 'foreign-link-owner@example.com')
    own_other_event = _make_event(client, other)
    for bad_path, auth in [(path, other),
                           (f'/api/v1/events/{own_other_event}/existing-investigations/{case_id}', other),
                           (f'/api/v1/events/{event_id}/existing-investigations/999999', headers)]:
        for method, suffix in [('get', '/preview'), ('post', '')]:
            kwargs = {'headers': auth}
            if method == 'post':
                kwargs['json'] = {'reviewed_fingerprint': preview['reviewed_fingerprint']}
            response = getattr(client, method)(bad_path + suffix, **kwargs)
            assert response.status_code == 404
            assert 'Existing investigation' not in response.text and 'Recorded gateway' not in response.text
    client.cookies.clear()
    assert client.get(path + '/preview').status_code in (401, 403)
    assert client.post(path, json={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code in (401, 403)


@pytest.mark.parametrize('body', [{}, {'reviewed_fingerprint': 'bad'},
                                  {'reviewed_fingerprint': 'a' * 64, 'title': 'Unexpected'}])
def test_invalid_review_body_cannot_write(client, body):
    headers, _event_id, _case_id, path, _preview = prepare(client)
    assert client.post(path, headers=headers, json=body).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == 0


def test_linking_closed_case_preserves_close_out_and_existing_links(client):
    from datetime import UTC, datetime
    headers, event_id, case_id, path, _preview = prepare(client)
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        case.status = 'closed'
        case.resolution = 'Recorded close out'
        case.closed_at = datetime(2026, 1, 1, tzinfo=UTC)
        second = Case(user_id=case.user_id, title='Another investigation')
        db.add(second)
        db.flush()
        db.add(CaseEvent(case_id=second.id, event_id=event_id))
        db.commit()
    preview = client.get(path + '/preview', headers=headers).json()
    assert preview['case']['status'] == 'closed'
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 200
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        assert case.status == 'closed' and case.resolution == 'Recorded close out' and case.closed_at is not None
        assert db.query(Case).count() == db.query(CaseEvent).count() == 2


def test_concurrent_same_review_serializes_without_duplicate_links(client):
    headers, _event_id, _case_id, path, preview = prepare(client)
    def link(_):
        return client.post(path, headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(link, range(2)))
    assert sorted(results) == [200, 409]
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 1


def test_commit_failure_rolls_back_link_label_timeline_and_audit(client, monkeypatch):
    from test_events_export import _AsyncTestingSessionLocal
    headers, event_id, _case_id, path, preview = prepare(client)
    original = _AsyncTestingSessionLocal.class_.commit
    async def fail(session):
        if any(isinstance(item, CaseEvent) for item in session.new):
            raise RuntimeError('simulated existing-link commit failure')
        return await original(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated existing-link commit failure'):
        client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 0
        assert db.get(SecurityEvent, event_id).processed == 'pending'
        assert db.query(AuditLog).filter_by(action='case_event_linked').count() == 0


def test_legacy_case_link_and_reviewed_link_share_case_lock_without_duplicates(client):
    headers, event_id, case_id, path, preview = prepare(client)
    def link(kind):
        if kind == 'reviewed':
            return client.post(path, headers=headers,
                               json={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code
        return client.post(f'/api/v1/cases/{case_id}/events/{event_id}', headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(link, ['reviewed', 'legacy']))
    assert results[0] in (200, 409) and results[1] == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('owner_change', ['event', 'case'])
def test_ownership_change_since_review_refuses_without_disclosing_either_record(client, owner_change):
    headers, event_id, case_id, path, preview = prepare(client)
    with _TestingSessionLocal() as db:
        record = db.get(SecurityEvent, event_id) if owner_change == 'event' else db.get(Case, case_id)
        record.user_id = 999
        db.commit()
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 404
    assert 'Recorded gateway' not in response.text and 'Existing investigation' not in response.text
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('value', ['0', '-1', '9007199254740992', '99999999999999999999999999999', '1.5'])
@pytest.mark.parametrize('field', ['event', 'case'])
def test_invalid_exact_path_ids_are_validation_errors_not_database_overflows(client, value, field):
    headers, event_id, case_id, _path, preview = prepare(client)
    path = (f'/api/v1/events/{value if field == "event" else event_id}/existing-investigations/'
            f'{value if field == "case" else case_id}')
    assert client.get(path + '/preview', headers=headers).status_code == 422
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 0
