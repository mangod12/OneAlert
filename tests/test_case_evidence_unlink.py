"""Reviewed unlinking removes exact relationships, preserving evidence and case state."""
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime

import pytest
from test_case_create import TestCaseAlertLinking as AlertHelper
from test_case_create import _TestingSessionLocal, register_and_login
from test_case_create import client as client

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent


def prepare(client, kind, duplicates=1):
    headers = register_and_login(client, 'reviewed-unlink@example.com')
    alert_id = AlertHelper()._make_alert(client, headers, title='Recorded gateway finding')
    with _TestingSessionLocal() as db:
        owner = db.get(Alert, alert_id).user_id
        db.get(Alert, alert_id).severity = 'critical'
        event = SecurityEvent(user_id=owner, timestamp=datetime(2026, 1, 1, tzinfo=UTC), event_type='auth',
                              signature='Recorded gateway event', severity='high', processed='in_case',
                              raw_data={'counter': 9007199254740993})
        db.add(event)
        db.flush()
        model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
        identity = alert_id if kind == 'alert' else event.id
        case = Case(user_id=owner, title='Reviewed destination', summary='Recorded case summary',
                    status='closed', severity='critical', due_date=date(2026, 1, 2),
                    closed_at=datetime(2026, 1, 3, tzinfo=UTC), resolution='Recorded close-out')
        other = Case(user_id=owner, title='Other owned investigation')
        foreign = Case(user_id=999, title='PRIVATE CASE')
        db.add_all([case, other, foreign])
        db.flush()
        for row in [case] * duplicates + [other, foreign]:
            db.add(link(case_id=row.id, **{f'{kind}_id': identity}))
        db.commit()
        case_id = case.id
        original = {column.name: str(getattr(db.get(model, identity), column.name))
                    for column in model.__table__.columns}
    path = f'/api/v1/cases/{case_id}/evidence/{kind}/{identity}'
    result = client.get(path + '/unlink-preview', headers=headers)
    assert result.status_code == 200, result.text
    return headers, case_id, identity, path, result.json(), original


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_exact_review_unlinks_all_pair_duplicates_but_keeps_evidence_other_links_and_case(client, kind):
    headers, case_id, identity, path, preview, original = prepare(client, kind, duplicates=2)
    assert preview['link_count'] == 2 and preview['other_owned_case_count'] == 1
    assert preview['case']['status'] == 'closed' and 'PRIVATE CASE' not in str(preview)
    assert '9007199254740993' not in str(preview) and len(preview['record_fingerprint']) == 64
    payload = {'reviewed_fingerprint': preview['reviewed_fingerprint'],
               'reason': '  Evidence belongs in another case  '}
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0
        original_case = {column.name: str(getattr(db.get(Case, case_id), column.name))
                         for column in Case.__table__.columns}
    result = client.post(path + '/unlink', headers=headers, json=payload)
    assert result.status_code == 200, result.text
    assert result.json() == {'case_id': case_id, 'kind': kind, 'record_id': identity, 'unlinked': True,
                             'removed_link_rows': 2, 'reviewed_fingerprint': preview['reviewed_fingerprint']}
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        record, case = db.get(model, identity), db.get(Case, case_id)
        assert {column.name: str(getattr(record, column.name)) for column in model.__table__.columns} == original
        assert db.query(link).filter_by(case_id=case_id).count() == 0
        assert db.query(link).count() == 2  # Other owned and foreign relationships remain untouched.
        assert case.severity == 'critical' and case.status == 'closed' and case.due_date == date(2026, 1, 2)
        assert case.closed_at is not None and case.resolution == 'Recorded close-out'
        assert {column.name: str(getattr(case, column.name)) for column in Case.__table__.columns} == original_case
        timeline = db.query(CaseTimeline).one()
        assert timeline.metadata_json['reason'] == 'Evidence belongs in another case'
        assert timeline.metadata_json['removed_link_rows'] == 2 and timeline.source == 'human'
        assert db.query(AuditLog).filter_by(action='case_evidence_unlinked', target_id=case_id).count() == 1
    assert client.post(path + '/unlink', headers=headers, json=payload).status_code == 409
    fresh = client.get(path + '/unlink-preview', headers=headers).json()
    assert fresh['link_count'] == 0 and fresh['other_owned_case_count'] == 1
    noop = client.post(path + '/unlink', headers=headers,
                       json={'reviewed_fingerprint': fresh['reviewed_fingerprint'],
                             'reason': 'Checked current absence'})
    assert noop.status_code == 200 and noop.json()['removed_link_rows'] == 0
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('kind', ['alert', 'event'])
@pytest.mark.parametrize('change', ['label', 'hidden', 'processing', 'case_title',
                                    'case_status', 'duplicate', 'other_owned'])
def test_changed_evidence_case_or_owned_relationships_refuses_stale_unlink(client, kind, change):
    headers, case_id, identity, path, preview, _ = prepare(client, kind)
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        record, case = db.get(model, identity), db.get(Case, case_id)
        if change == 'label':
            setattr(record, 'title' if kind == 'alert' else 'signature', 'Changed recorded label')
        elif change == 'hidden':
            setattr(record, 'remediation' if kind == 'alert' else 'raw_data',
                    'Changed hidden content' if kind == 'alert' else {'counter': 9007199254740994})
        elif change == 'processing':
            setattr(record, 'status' if kind == 'alert' else 'processed', 'resolved' if kind == 'alert' else 'pending')
        elif change == 'case_title':
            case.title = 'Changed destination'
        elif change == 'case_status':
            case.status = 'open'
        elif change == 'duplicate':
            db.add(link(case_id=case_id, **{f'{kind}_id': identity}))
        else:
            other = Case(user_id=case.user_id, title='New owned relationship')
            db.add(other)
            db.flush()
            db.add(link(case_id=other.id, **{f'{kind}_id': identity}))
        db.commit()
    response = client.post(path + '/unlink', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'reason': 'Reviewed reason'})
    assert response.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(link).filter_by(case_id=case_id).count() == (2 if change == 'duplicate' else 1)
        assert db.query(CaseTimeline).count() == 0
        assert db.query(AuditLog).filter_by(action='case_evidence_unlinked').count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_foreign_case_or_record_and_anonymous_requests_cannot_preview_or_unlink(client, kind):
    headers, case_id, identity, path, preview, _ = prepare(client, kind)
    other = register_and_login(client, 'foreign-unlink@example.com')
    for suffix in ['/unlink-preview', '/unlink']:
        kwargs = {'headers': other}
        if suffix == '/unlink':
            kwargs['json'] = {'reviewed_fingerprint': preview['reviewed_fingerprint'], 'reason': 'Not authorized'}
        result = (client.get if suffix.endswith('preview') else client.post)(path + suffix, **kwargs)
        assert result.status_code == 404 and 'Recorded' not in result.text
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        db.get(model, identity).user_id = 999
        db.commit()
    assert client.get(path + '/unlink-preview', headers=headers).status_code == 404
    assert client.post(path + '/unlink', headers=headers,
                       json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'reason': 'Stale ownership'}
                       ).status_code == 404
    with _TestingSessionLocal() as db:
        assert db.query(link).filter_by(case_id=case_id).count() == 1
    client.cookies.clear()
    assert client.get(path + '/unlink-preview').status_code in (401, 403)
    assert client.post(path + '/unlink', json={'reviewed_fingerprint': 'a' * 64, 'reason': 'Anonymous'}
                       ).status_code in (401, 403)


@pytest.mark.parametrize('body', [{}, {'reason': 'Reason'}, {'reviewed_fingerprint': 'bad', 'reason': 'Reason'},
                                 {'reviewed_fingerprint': 'a' * 64, 'reason': ''},
                                 {'reviewed_fingerprint': 'a' * 64, 'reason': '  '},
                                 {'reviewed_fingerprint': 'a' * 64, 'reason': 'x' * 1001},
                                 {'reviewed_fingerprint': 'a' * 64, 'reason': 'Reason', 'delete_original': True}])
def test_invalid_reason_or_review_cannot_remove_any_links(client, body):
    headers, case_id, _identity, path, _preview, _ = prepare(client, 'event')
    assert client.post(path + '/unlink', headers=headers, json=body).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseEvent).filter_by(case_id=case_id).count() == 1
        assert db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_concurrent_same_review_does_not_duplicate_history(client, kind):
    headers, _case_id, _identity, path, preview, _ = prepare(client, kind)
    def unlink(_):
        return client.post(path + '/unlink', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'reason': 'Reviewed reason'}
                           ).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(unlink, range(2)))
    assert sorted(results) == [200, 409]
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_failure_rolls_back_deleted_relationships_timeline_and_audit(client, kind, monkeypatch):
    from test_case_create import _AsyncTestingSessionLocal
    headers, case_id, identity, path, preview, original = prepare(client, kind, duplicates=2)
    commit = _AsyncTestingSessionLocal.class_.commit
    async def fail(session):
        if any(isinstance(row, CaseTimeline) for row in session.new):
            raise RuntimeError('simulated reviewed unlink failure')
        return await commit(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated reviewed unlink failure'):
        client.post(path + '/unlink', headers=headers,
                    json={'reviewed_fingerprint': preview['reviewed_fingerprint'], 'reason': 'Reviewed reason'})
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        record = db.get(model, identity)
        assert db.query(link).filter_by(case_id=case_id).count() == 2
        assert {column.name: str(getattr(record, column.name)) for column in model.__table__.columns} == original
        assert db.query(CaseTimeline).count() == 0
        assert db.query(AuditLog).filter_by(action='case_evidence_unlinked').count() == 0


@pytest.mark.parametrize('value', ['0', '-1', '9007199254740992', '999999999999999999999999999999'])
def test_invalid_exact_ids_are_rejected_before_database_lookup(client, value):
    headers, case_id, identity, _path, _preview, _ = prepare(client, 'event')
    for path in [f'/api/v1/cases/{value}/evidence/event/{identity}',
                 f'/api/v1/cases/{case_id}/evidence/event/{value}']:
        assert client.get(path + '/unlink-preview', headers=headers).status_code == 422
        assert client.post(path + '/unlink', headers=headers,
                           json={'reviewed_fingerprint': 'a' * 64, 'reason': 'Reason'}).status_code == 422


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_last_owned_link_removal_keeps_original_processing_and_does_not_requeue(client, kind):
    headers, case_id, identity, path, _preview, original = prepare(client, kind)
    model, link = (Alert, CaseAlert) if kind == 'alert' else (SecurityEvent, CaseEvent)
    with _TestingSessionLocal() as db:
        owner = db.get(Case, case_id).user_id
        other_owned = [row.id for row in db.query(Case).filter(Case.user_id == owner, Case.id != case_id)]
        db.query(link).filter(link.case_id.in_(other_owned)).delete(synchronize_session=False)
        db.commit()
    preview = client.get(path + '/unlink-preview', headers=headers).json()
    assert preview['other_owned_case_count'] == 0 and preview['link_count'] == 1
    response = client.post(path + '/unlink', headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint'],
                                 'reason': 'Reviewed last link'})
    assert response.status_code == 200 and response.json()['removed_link_rows'] == 1
    with _TestingSessionLocal() as db:
        record = db.get(model, identity)
        assert {column.name: str(getattr(record, column.name)) for column in model.__table__.columns} == original
        assert db.query(link).count() == 1  # A private foreign relationship remains, not disclosed or changed.
        assert db.query(link).filter_by(case_id=case_id).count() == 0
