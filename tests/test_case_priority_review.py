"""Priority review binds saved case and notification audience."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, client

from backend.models.case import Case, CaseWatcher
from backend.models.user import User


def setup(client, field='severity', value='critical'):
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    response = client.get(f'/api/v1/cases/{cid}/priority-review', headers=headers,
                          params={'field': field, 'value': value})
    assert response.status_code == 200, response.text
    return headers, cid, response.json()


def save(client, headers, cid, preview):
    return client.post(f'/api/v1/cases/{cid}/priority-reviewed', headers=headers, json={
        'field': preview['field'], 'value': preview['value'], 'reviewed_fingerprint': preview['reviewed_fingerprint']})


@pytest.mark.parametrize('field,value', [('severity', 'critical'), ('due_date', '2026-12-01')])
def test_exact_priority_change(client, field, value):
    headers, cid, preview = setup(client, field, value)
    result = save(client, headers, cid, preview)
    assert result.status_code == 200, result.text
    assert result.json() == {'success': True, 'case_id': cid, 'field': field, 'value': value,
                             'reviewed_fingerprint': preview['reviewed_fingerprint']}
    assert save(client, headers, cid, preview).status_code in {401, 409}


@pytest.mark.parametrize('change', [
    'title', 'severity', 'due_date', 'watcher', 'recipient_email', 'recipient_preferences',
])
def test_changed_source_blocks_priority(client, change):
    headers, cid, preview = setup(client)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        if change == 'title':
            case.title = 'Changed'
        elif change == 'severity':
            case.severity = 'low'
        elif change == 'due_date':
            from datetime import date
            case.due_date = date(2026, 12, 2)
        elif change == 'watcher':
            db.add(CaseWatcher(case_id=cid, user_id=case.user_id))
        elif change == 'recipient_email':
            db.get(User, case.user_id).email = 'changed@example.com'
        else:
            db.get(User, case.user_id).notify_min_severity = 'critical'
        db.commit()
    assert save(client, headers, cid, preview).status_code in {401, 409}


@pytest.mark.parametrize('field,value', [('severity', 'urgent'), ('due_date', '20261201'), ('due_date', '2026-02-30')])
def test_invalid_priority_never_saves(client, field, value):
    headers, cid, _ = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/priority-review', headers=headers,
                      params={'field': field, 'value': value}).status_code == 422


def test_nonowner_cannot_review_or_change(client):
    _headers, cid, preview = setup(client)
    other = _register_and_login(client, 'other@example.com')
    assert client.get(f'/api/v1/cases/{cid}/priority-review', headers=other,
                      params={'field': 'severity', 'value': 'critical'}).status_code == 404
    assert save(client, other, cid, preview).status_code == 404


def test_clear_date_rearms_reminders_and_keeps_other_fields(client):
    from datetime import UTC, date, datetime
    headers, cid, _ = setup(client)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        case.due_date = date(2026, 12, 1)
        case.sla_breach_notified_at = case.sla_due_soon_notified_at = datetime.now(UTC)
        db.commit()
    preview = client.get(f'/api/v1/cases/{cid}/priority-review', headers=headers,
                         params={'field': 'due_date', 'value': ''}).json()
    assert save(client, headers, cid, preview).status_code == 200
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert case.due_date is case.sla_breach_notified_at is case.sla_due_soon_notified_at is None
        assert case.status == 'open'


def test_notification_audience_is_exact_and_webhook_never_disclosed(client, monkeypatch):
    from test_case_assignment import _share_org, _user_id

    from backend.models.notification import Notification
    async def no_delivery(*args, **kwargs):
        pass
    monkeypatch.setattr('backend.routers.cases.notify_investigation_event', no_delivery)
    headers, cid, _ = setup(client)
    other = _register_and_login(client, 'recipient@example.com')
    target = _user_id(client, other)
    owner = _user_id(client, headers)
    _share_org(owner, target)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = target
        db.get(User, target).webhook_url = 'https://example.invalid/private-endpoint'
        db.add(CaseWatcher(case_id=cid, user_id=target))
        db.commit()
    result = client.get(f'/api/v1/cases/{cid}/priority-review', headers=headers,
                        params={'field': 'severity', 'value': 'critical'})
    assert 'private-endpoint' not in result.text
    preview = result.json()
    assert preview['recipients'] == [{'id': target, 'email': 'recipient@example.com',
                                      'full_name': preview['recipients'][0]['full_name'],
                                      'role': 'viewer', 'is_active': True}]
    assert save(client, headers, cid, preview).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(Notification).filter_by(user_id=target, kind='case_updated').count() == 1
