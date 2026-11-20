"""Reviewed event investigations create the case, exact link, timeline and audit atomically."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.models.user import User


def prepare(client):
    headers = _register_and_login(client, 'reviewed-event-investigation@example.com')
    identity = _make_event(client, headers, signature='Saved gateway evidence', source_ip='10.0.0.7',
                           raw_data={'counter': 9007199254740993})
    response = client.get(f'/api/v1/events/{identity}/investigation-preview', headers=headers)
    assert response.status_code == 200, response.text
    preview = response.json()
    payload = {'title': ' Reviewed case ', 'summary': ' Saved evidence only ', 'severity': 'high',
               'reviewed_fingerprint': preview['reviewed_fingerprint']}
    return headers, identity, preview, payload


def test_preview_is_read_only_and_creation_is_one_audited_transaction(client):
    headers, identity, preview, payload = prepare(client)
    assert preview['event']['id'] == identity and preview['existing_case_count'] == 0
    assert set(preview['due_dates']) == {'info', 'low', 'medium', 'high', 'critical'}
    assert 'raw_data' not in str(preview) and len(preview['event_fingerprint']) == 64
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == db.query(CaseEvent).count() == 0
    result = client.post(f'/api/v1/events/{identity}/investigations', headers=headers, json=payload)
    assert result.status_code == 201, result.text
    data = result.json()
    assert data['linked'] is True and data['event_id'] == identity
    assert data['reviewed_fingerprint'] == preview['reviewed_fingerprint']
    with _TestingSessionLocal() as db:
        case = db.get(Case, data['id'])
        assert case.title == 'Reviewed case' and case.summary == 'Saved evidence only'
        assert case.created_by == 'human' and case.status == 'open'
        assert db.query(CaseEvent).filter_by(case_id=case.id, event_id=identity).count() == 1
        assert db.get(SecurityEvent, identity).processed == 'in_case'
        assert db.query(CaseTimeline).filter_by(case_id=case.id, entry_type='event').count() == 1
        assert db.query(AuditLog).filter_by(target_id=case.id, action='case_created').count() == 1
    # The exact same review cannot create another case after a confirmed or uncertain response.
    assert client.post(f'/api/v1/events/{identity}/investigations', headers=headers, json=payload).status_code == 409
    reread = client.get(f'/api/v1/events/{identity}/investigation-preview', headers=headers).json()
    assert reread['existing_case_count'] == 1 and reread['existing_cases'][0]['id'] == data['id']


@pytest.mark.parametrize('change', ['signature', 'payload', 'case_link', 'sla'])
def test_changed_evidence_links_or_sla_rejects_stale_review_without_orphans(client, change):
    headers, identity, _preview, payload = prepare(client)
    with _TestingSessionLocal() as db:
        event = db.get(SecurityEvent, identity)
        if change == 'signature':
            event.signature = 'Changed evidence'
        elif change == 'payload':
            event.raw_data = {'counter': 9007199254740994}
        elif change == 'case_link':
            case = Case(user_id=event.user_id, title='Existing', severity='high')
            db.add(case)
            db.flush()
            db.add(CaseEvent(case_id=case.id, event_id=identity))
        else:
            user = db.get(User, event.user_id)
            user.sla_due_dates_enabled = True
            user.sla_days_high = 3
        db.commit()
    result = client.post(f'/api/v1/events/{identity}/investigations', headers=headers, json=payload)
    assert result.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == (1 if change == 'case_link' else 0)
        assert db.query(CaseTimeline).count() == 0


def test_foreign_event_and_linked_foreign_cases_are_not_disclosed(client):
    headers, identity, _preview, payload = prepare(client)
    other = _register_and_login(client, 'private-event-investigator@example.com')
    for suffix in ['investigation-preview', 'investigations']:
        response = (client.get(f'/api/v1/events/{identity}/{suffix}', headers=other) if suffix.endswith('preview')
                    else client.post(f'/api/v1/events/{identity}/{suffix}', headers=other, json=payload))
        assert response.status_code == 404
    with _TestingSessionLocal() as db:
        foreign = Case(user_id=999, title='Private case title', severity='critical')
        db.add(foreign)
        db.flush()
        db.add(CaseEvent(case_id=foreign.id, event_id=identity))
        db.commit()
    data = client.get(f'/api/v1/events/{identity}/investigation-preview', headers=headers).json()
    assert data['existing_case_count'] == 0 and 'Private case title' not in str(data)


@pytest.mark.parametrize('changes', [{'title': '  '}, {'title': 'x' * 201}, {'severity': 'unknown'},
                                     {'reviewed_fingerprint': 'bad'}, {'summary': 'x' * 2001},
                                     {'extra': True}])
def test_invalid_creation_cannot_write_cases(client, changes):
    headers, identity, _preview, payload = prepare(client)
    assert client.post(f'/api/v1/events/{identity}/investigations', headers=headers,
                       json=dict(payload, **changes)).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == 0


def test_two_concurrent_sqlite_requests_with_same_review_do_not_create_duplicates(client):
    headers, identity, _preview, payload = prepare(client)
    def create():
        return client.post(f'/api/v1/events/{identity}/investigations', headers=headers, json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: create(), range(2)))
    assert sorted(statuses) == [201, 409]
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == db.query(CaseEvent).count() == 1


def test_commit_failure_rolls_back_case_event_link_and_processing_label(client, monkeypatch):
    from test_events_export import _AsyncTestingSessionLocal
    headers, identity, _preview, payload = prepare(client)
    original = _AsyncTestingSessionLocal.class_.commit
    async def fail_commit(session):
        if any(isinstance(row, CaseEvent) for row in session.new):
            raise RuntimeError('simulated transaction failure')
        return await original(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail_commit)
    with pytest.raises(RuntimeError, match='simulated transaction failure'):
        client.post(f'/api/v1/events/{identity}/investigations', headers=headers, json=payload)
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == db.query(CaseEvent).count() == db.query(CaseTimeline).count() == 0
        assert db.get(SecurityEvent, identity).processed == 'pending'


def test_preview_caps_owned_case_details_and_anonymous_requests_cannot_read_or_create(client):
    headers, identity, _preview, payload = prepare(client)
    with _TestingSessionLocal() as db:
        owner = db.get(SecurityEvent, identity).user_id
        for index in range(25):
            case = Case(user_id=owner, title=f'Owned linked case {index}', severity='medium')
            db.add(case)
            db.flush()
            db.add(CaseEvent(case_id=case.id, event_id=identity))
        db.commit()
    preview = client.get(f'/api/v1/events/{identity}/investigation-preview', headers=headers).json()
    assert preview['existing_case_count'] == 25 and len(preview['existing_cases']) == 20
    ids = [case['id'] for case in preview['existing_cases']]
    assert ids == sorted(ids, reverse=True)
    client.cookies.clear()
    assert client.get(f'/api/v1/events/{identity}/investigation-preview').status_code in (401, 403)
    assert client.post(f'/api/v1/events/{identity}/investigations', json=payload).status_code in (401, 403)
