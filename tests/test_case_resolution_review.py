"""Exact owner-only resolution text review, preserving completion state."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, client

from backend.models.case import Case


def setup(client):
    from datetime import UTC, datetime
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        case.status, case.resolution = 'resolved', 'Saved resolution'
        case.closed_at = datetime(2026, 11, 23, tzinfo=UTC)
        db.commit()
    proposal = {'resolution': '  Reviewed resolution  '}
    response = client.post(f'/api/v1/cases/{cid}/resolution-review', headers=headers, json=proposal)
    assert response.status_code == 200, response.text
    return headers, cid, proposal, response.json()


def save(client, headers, cid, proposal, preview):
    return client.post(f'/api/v1/cases/{cid}/resolution-reviewed', headers=headers, json={
        **proposal, 'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_exact_resolution_preview_readonly_apply_receipt_no_other_changes(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    headers, cid, proposal, preview = setup(client)
    assert preview['new_resolution'] == 'Reviewed resolution' and preview['resolution'] == 'Saved resolution'
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert case.resolution == preview['resolution']
        before = (case.title, case.summary, case.status, case.severity, case.due_date,
                  case.assigned_to_id, case.closed_at, case.sla_breach_notified_at)
        count = db.query(Notification).count()
    result = save(client, headers, cid, proposal, preview)
    assert result.status_code == 200 and result.json() == {
        'success': True, 'case_id': cid, 'resolution': 'Reviewed resolution',
        'reviewed_fingerprint': preview['reviewed_fingerprint']}
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert (case.title, case.summary, case.status, case.severity, case.due_date,
                case.assigned_to_id, case.closed_at, case.sla_breach_notified_at) == before
        assert db.query(Notification).count() == count
        rows = db.query(AuditLog).filter_by(target_id=cid, action='case_resolution_reviewed').all()
        assert len(rows) == 1 and preview['reviewed_fingerprint'] in rows[0].detail
    assert save(client, headers, cid, proposal, preview).status_code == 409


@pytest.mark.parametrize('field,value', [('title', 'Elsewhere'), ('summary', 'Elsewhere'),
    ('status', 'open'), ('severity', 'low'), ('resolution', 'New resolution'), ('closed_at', None)])
def test_changed_saved_context_blocks_resolution(client, field, value):
    headers, cid, proposal, preview = setup(client)
    with _TestingSessionLocal() as db:
        setattr(db.get(Case, cid), field, value)
        db.commit()
    assert save(client, headers, cid, proposal, preview).status_code == 409


def test_changed_proposal_blocks_and_clear_resolution_is_explicit(client):
    headers, cid, proposal, preview = setup(client)
    assert save(client, headers, cid, {'resolution': 'Different'}, preview).status_code == 409
    proposal['resolution'] = '   '
    preview = client.post(f'/api/v1/cases/{cid}/resolution-review', headers=headers, json=proposal).json()
    assert preview['new_resolution'] is None
    assert save(client, headers, cid, proposal, preview).json()['resolution'] is None


@pytest.mark.parametrize('proposal', [{'resolution': 'x' * 20001}, {'resolution': 12},
    {'resolution': 'x', 'status': 'closed'}])
def test_invalid_resolution_fails_before_write(client, proposal):
    headers, cid, _, _ = setup(client)
    assert client.post(f'/api/v1/cases/{cid}/resolution-review', headers=headers, json=proposal).status_code == 422


def test_nonowner_and_assignee_cannot_preview_or_apply(client):
    from test_case_assignment import _user_id
    _headers, cid, proposal, preview = setup(client)
    other = _register_and_login(client, 'other@example.com')
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = _user_id(client, other)
        db.commit()
    assert client.post(f'/api/v1/cases/{cid}/resolution-review', headers=other, json=proposal).status_code == 404
    assert save(client, other, cid, proposal, preview).status_code == 404
