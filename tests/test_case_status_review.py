"""Review active/reopen status changes and exact watcher notification audience."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, client

from backend.models.case import Case, CaseWatcher


def setup(client, old='resolved', new='investigating'):
    from datetime import UTC, datetime
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        case.status, case.resolution = old, 'Retained resolution'
        case.closed_at = datetime(2026, 11, 23, tzinfo=UTC) if old in {'resolved', 'closed'} else None
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/status-review', headers=headers, params={'value': new})
    assert response.status_code == 200, response.text
    return headers, cid, response.json()


def save(client, headers, cid, preview):
    return client.post(f'/api/v1/cases/{cid}/status-reviewed', headers=headers, json={
        'value': preview['value'], 'reviewed_fingerprint': preview['reviewed_fingerprint']})


@pytest.mark.parametrize('old,new', [('resolved', 'investigating'), ('closed', 'open'),
    ('open', 'investigating'), ('investigating', 'open')])
def test_exact_status_change_preserves_resolution_priority_and_tasks(client, old, new):
    from backend.models.audit_log import AuditLog
    headers, cid, preview = setup(client, old, new)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        before = (case.title, case.summary, case.resolution, case.severity, case.due_date, case.assigned_to_id)
    response = save(client, headers, cid, preview)
    assert response.status_code == 200, response.text
    assert response.json()['closed_at'] is None
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert case.status == new and case.closed_at is None
        assert (case.title, case.summary, case.resolution, case.severity, case.due_date, case.assigned_to_id) == before
        assert db.query(AuditLog).filter_by(target_id=cid, action='case_status_reviewed').count() == 1
    assert save(client, headers, cid, preview).status_code == 409


@pytest.mark.parametrize('field,value', [('title', 'Changed'), ('status', 'closed'),
    ('resolution', 'Changed'), ('closed_at', None)])
def test_changed_saved_context_blocks_status(client, field, value):
    headers, cid, preview = setup(client)
    with _TestingSessionLocal() as db:
        setattr(db.get(Case, cid), field, value)
        db.commit()
    assert save(client, headers, cid, preview).status_code == 409


def test_exact_watcher_audience_stale_settings_block_and_assignee_can_review(client, monkeypatch):
    from test_case_assignment import _share_org, _user_id

    from backend.models.notification import Notification
    from backend.models.user import User
    async def no_delivery(*args, **kwargs):
        pass
    monkeypatch.setattr('backend.routers.cases.notify_investigation_event', no_delivery)
    headers, cid, _ = setup(client)
    assignee_headers = _register_and_login(client, 'assignee@example.com')
    watcher_headers = _register_and_login(client, 'watcher@example.com')
    owner, assignee, watcher = [_user_id(client, h) for h in [headers, assignee_headers, watcher_headers]]
    _share_org(owner, assignee)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = assignee
        db.add(CaseWatcher(case_id=cid, user_id=watcher))
        db.get(User, watcher).webhook_url = 'https://example.invalid/private-channel'
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/status-review', headers=assignee_headers,
                          params={'value': 'investigating'})
    assert response.status_code == 200 and 'private-channel' not in response.text
    preview = response.json()
    assert preview['acting_account_id'] == assignee
    assert [r['id'] for r in preview['recipients']] == [watcher]
    with _TestingSessionLocal() as db:
        db.get(User, watcher).notify_min_severity = 'critical'
        db.commit()
    assert save(client, assignee_headers, cid, preview).status_code == 409
    preview = client.get(f'/api/v1/cases/{cid}/status-review', headers=assignee_headers,
                         params={'value': 'investigating'}).json()
    assert save(client, assignee_headers, cid, preview).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(Notification).filter_by(user_id=watcher, kind='case_updated').count() == 1
        assert db.query(Notification).filter_by(user_id=owner, kind='case_updated').count() == 0


def test_watcher_cannot_change_status_and_invalid_transition_rejected(client):
    from test_case_assignment import _user_id
    headers, cid, preview = setup(client)
    other = _register_and_login(client, 'watcher@example.com')
    with _TestingSessionLocal() as db:
        db.add(CaseWatcher(case_id=cid, user_id=_user_id(client, other)))
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}/status-review', headers=other,
                      params={'value': 'investigating'}).status_code == 403
    assert save(client, other, cid, preview).status_code == 403
    assert client.get(f'/api/v1/cases/{cid}/status-review', headers=headers,
                      params={'value': 'open'}).status_code == 409
    assert client.get(f'/api/v1/cases/{cid}/status-review', headers=headers,
                      params={'value': 'resolved'}).status_code == 422
