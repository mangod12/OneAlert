"""Owned alert evidence links with exact case and resulting severity review."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_case_create import TestCaseAlertLinking as AlertHelper
from test_case_create import _TestingSessionLocal
from test_case_create import client as client
from test_case_create import register_and_login as _register_and_login

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert, CaseTimeline


def prepare(client, **case_fields):
    headers = _register_and_login(client, 'existing-alert-link-owner@example.com')
    alert_id = AlertHelper()._make_alert(client, headers, title='Recorded gateway evidence')
    with _TestingSessionLocal() as db:
        alert = db.get(Alert, alert_id)
        alert.remediation = 'Unshown detail 9007199254740993'
        case = Case(user_id=alert.user_id, title='Existing investigation', summary='Recorded summary',
                    severity=case_fields.pop('severity', 'high'), status='open', **case_fields)
        db.add(case)
        db.commit()
        case_id = case.id
    path = f'/api/v1/alerts/{alert_id}/existing-investigations/{case_id}'
    preview = client.get(path + '/preview', headers=headers)
    assert preview.status_code == 200, preview.text
    return headers, alert_id, case_id, path, preview.json()


def test_preview_read_only_then_link_is_one_audited_transaction(client):
    headers, alert_id, case_id, path, preview = prepare(client)
    assert preview['alert']['id'] == alert_id and preview['case']['id'] == case_id
    assert preview['case']['summary'] == 'Recorded summary' and preview['already_linked'] is False
    assert '9007199254740993' not in str(preview) and len(preview['alert_fingerprint']) == 64
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 0
        assert db.get(Alert, alert_id).status == 'pending'
    body = {'reviewed_fingerprint': preview['reviewed_fingerprint']}
    response = client.post(path, headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json() == dict(body, alert_id=alert_id, case_id=case_id, linked=True, created=True, severity='high')
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 1
        assert db.get(Alert, alert_id).status == 'pending'
        assert db.query(AuditLog).filter_by(action='case_alert_linked', target_id=case_id).count() == 1
        assert db.get(Case, case_id).status == 'open'
    # Lost responses cannot lead to a blind duplicate write with the old review.
    assert client.post(path, headers=headers, json=body).status_code == 409
    fresh = client.get(path + '/preview', headers=headers).json()
    assert fresh['already_linked'] is True
    noop = client.post(path, headers=headers, json={'reviewed_fingerprint': fresh['reviewed_fingerprint']})
    assert noop.status_code == 200 and noop.json()['created'] is False
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('changed', ['alert_title', 'remediation', 'alert_status', 'title', 'summary', 'status',
                                     'severity', 'due_date', 'assigned_to_id', 'closed_at', 'link'])
def test_stale_alert_case_or_relationship_rejects_without_write(client, changed):
    from datetime import UTC, date, datetime
    headers, alert_id, case_id, path, preview = prepare(client)
    with _TestingSessionLocal() as db:
        alert, case = db.get(Alert, alert_id), db.get(Case, case_id)
        if changed == 'alert_title':
            alert.title = 'Changed'
        elif changed == 'remediation':
            alert.remediation = 'Unshown detail 9007199254740994'
        elif changed == 'alert_status':
            alert.status = 'resolved'
        elif changed == 'link':
            db.add(CaseAlert(case_id=case_id, alert_id=alert_id))
        else:
            setattr(case, changed, {'due_date': date(2027, 1, 1), 'assigned_to_id': 999,
                                   'closed_at': datetime(2026, 1, 1, tzinfo=UTC)}.get(changed, 'changed'))
        db.commit()
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).count() == 0
        assert db.query(CaseAlert).count() == int(changed == 'link')
        assert db.query(AuditLog).filter_by(action='case_alert_linked').count() == 0


def test_both_records_must_be_owned_without_foreign_details_or_counts(client):
    headers, alert_id, case_id, path, preview = prepare(client)
    other = _register_and_login(client, 'foreign-link-owner@example.com')
    own_other_alert = AlertHelper()._make_alert(client, other)
    for bad_path, auth in [(path, other),
                           (f'/api/v1/alerts/{own_other_alert}/existing-investigations/{case_id}', other),
                           (f'/api/v1/alerts/{alert_id}/existing-investigations/999999', headers)]:
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
    headers, _alert_id, _case_id, path, _preview = prepare(client)
    assert client.post(path, headers=headers, json=body).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == 0


def test_linking_closed_case_preserves_close_out_and_existing_links(client):
    from datetime import UTC, datetime
    headers, alert_id, case_id, path, _preview = prepare(client)
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        case.status = 'closed'
        case.resolution = 'Recorded close out'
        case.closed_at = datetime(2026, 1, 1, tzinfo=UTC)
        second = Case(user_id=case.user_id, title='Another investigation')
        db.add(second)
        db.flush()
        db.add(CaseAlert(case_id=second.id, alert_id=alert_id))
        db.commit()
    preview = client.get(path + '/preview', headers=headers).json()
    assert preview['case']['status'] == 'closed'
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 200
    with _TestingSessionLocal() as db:
        case = db.get(Case, case_id)
        assert case.status == 'closed' and case.resolution == 'Recorded close out' and case.closed_at is not None
        assert db.query(Case).count() == db.query(CaseAlert).count() == 2


def test_concurrent_same_review_serializes_without_duplicate_links(client):
    headers, _alert_id, _case_id, path, preview = prepare(client)
    def link(_):
        return client.post(path, headers=headers,
                           json={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(link, range(2)))
    assert sorted(results) == [200, 409]
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 1


def test_commit_failure_rolls_back_link_label_timeline_and_audit(client, monkeypatch):
    from test_case_create import _AsyncTestingSessionLocal
    headers, alert_id, _case_id, path, preview = prepare(client)
    original = _AsyncTestingSessionLocal.class_.commit
    async def fail(session):
        if any(isinstance(item, CaseAlert) for item in session.new):
            raise RuntimeError('simulated existing-link commit failure')
        return await original(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated existing-link commit failure'):
        client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 0
        assert db.get(Alert, alert_id).status == 'pending'
        assert db.query(AuditLog).filter_by(action='case_alert_linked').count() == 0


def test_legacy_case_link_and_reviewed_link_share_case_lock_without_duplicates(client):
    headers, alert_id, case_id, path, preview = prepare(client)
    def link(kind):
        if kind == 'reviewed':
            return client.post(path, headers=headers,
                               json={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code
        return client.post(f'/api/v1/cases/{case_id}/alerts/{alert_id}', headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(link, ['reviewed', 'legacy']))
    assert results[0] in (200, 409) and results[1] == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 1


@pytest.mark.parametrize('owner_change', ['alert', 'case'])
def test_ownership_change_since_review_refuses_without_disclosing_either_record(client, owner_change):
    headers, alert_id, case_id, path, preview = prepare(client)
    with _TestingSessionLocal() as db:
        record = db.get(Alert, alert_id) if owner_change == 'alert' else db.get(Case, case_id)
        record.user_id = 999
        db.commit()
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 404
    assert 'Recorded gateway' not in response.text and 'Existing investigation' not in response.text
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('value', ['0', '-1', '9007199254740992', '99999999999999999999999999999', '1.5'])
@pytest.mark.parametrize('field', ['alert', 'case'])
def test_invalid_exact_path_ids_are_validation_errors_not_database_overflows(client, value, field):
    headers, alert_id, case_id, _path, preview = prepare(client)
    path = (f'/api/v1/alerts/{value if field == "alert" else alert_id}/existing-investigations/'
            f'{value if field == "case" else case_id}')
    assert client.get(path + '/preview', headers=headers).status_code == 422
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 422
    with _TestingSessionLocal() as db:
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 0


@pytest.mark.parametrize('alert_severity,case_severity,result', [
    ('critical', 'low', 'critical'), ('high', 'medium', 'high'), ('low', 'critical', 'critical'),
    ('high', 'high', 'high'), ('medium', 'low', 'medium'), ('low', 'info', 'low'),
])
def test_previewed_severity_raise_is_atomic_never_downgrades_or_retimes_sla(
    client, alert_severity, case_severity, result,
):
    from datetime import UTC, date, datetime
    headers, alert_id, case_id, path, _ = prepare(client, severity=case_severity)
    with _TestingSessionLocal() as db:
        case, alert = db.get(Case, case_id), db.get(Alert, alert_id)
        case.status = 'closed'
        case.closed_at = datetime(2026, 1, 1, tzinfo=UTC)
        case.resolution = 'Recorded close-out'
        case.due_date = date(2026, 1, 2)
        alert.severity = alert_severity
        db.commit()
    preview = client.get(path + '/preview', headers=headers).json()
    assert preview['resulting_severity'] == result
    with _TestingSessionLocal() as db:
        assert db.get(Case, case_id).severity == case_severity
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 200 and response.json()['severity'] == result
    with _TestingSessionLocal() as db:
        case, alert = db.get(Case, case_id), db.get(Alert, alert_id)
        assert case.severity == result and case.due_date == date(2026, 1, 2)
        assert case.status == 'closed' and case.resolution == 'Recorded close-out'
        assert case.closed_at is not None and alert.status == 'pending'
        assert db.query(CaseTimeline).count() == (2 if case_severity != result else 1)
    reread = client.get(path + '/preview', headers=headers).json()
    assert reread['already_linked'] is True and reread['resulting_severity'] == result


@pytest.mark.parametrize('status', ['sent', 'failed', 'acknowledged', 'resolved'])
def test_link_preserves_alert_delivery_or_triage_status(client, status):
    headers, alert_id, case_id, path, _ = prepare(client, severity='low')
    with _TestingSessionLocal() as db:
        db.get(Alert, alert_id).status = status
        db.commit()
    preview = client.get(path + '/preview', headers=headers).json()
    assert preview['alert']['status'] == status
    response = client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(Alert, alert_id).status == status and db.get(Case, case_id).severity == 'high'


def test_commit_failure_also_rolls_back_previewed_severity_raise(client, monkeypatch):
    from test_case_create import _AsyncTestingSessionLocal
    headers, _alert_id, case_id, path, preview = prepare(client, severity='low')
    assert preview['resulting_severity'] == 'high'
    original = _AsyncTestingSessionLocal.class_.commit
    async def fail(session):
        if any(isinstance(row, CaseAlert) for row in session.new):
            raise RuntimeError('simulated reviewed severity failure')
        return await original(session)
    monkeypatch.setattr(_AsyncTestingSessionLocal.class_, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated reviewed severity failure'):
        client.post(path, headers=headers, json={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    with _TestingSessionLocal() as db:
        assert db.get(Case, case_id).severity == 'low'
        assert db.query(CaseAlert).count() == db.query(CaseTimeline).count() == 0
        assert db.query(AuditLog).filter_by(action='case_alert_linked').count() == 0
