"""Exact owner-only title and summary review, with stale-context rejection."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _seed_case_actor, _TestingSessionLocal, client

from backend.models.case import Case


def setup(client):
    headers = _seed_case_actor(client, 'owner@example.com')
    cid = _create_case(client, headers)
    proposal = {'title': '  Reviewed title  ', 'summary': '  Reviewed summary  '}
    response = client.post(f'/api/v1/cases/{cid}/details-review', headers=headers, json=proposal)
    assert response.status_code == 200, response.text
    return headers, cid, proposal, response.json()


def save(client, headers, cid, proposal, preview):
    return client.post(f'/api/v1/cases/{cid}/details-reviewed', headers=headers, json={
        **proposal, 'reviewed_fingerprint': preview['reviewed_fingerprint']})


def test_exact_details_preview_readonly_apply_receipt_and_no_other_changes(client):
    from backend.models.audit_log import AuditLog
    from backend.models.notification import Notification
    headers, cid, proposal, preview = setup(client)
    assert preview['new_title'] == 'Reviewed title' and preview['new_summary'] == 'Reviewed summary'
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert case.title == preview['title'] and case.summary == preview['summary']
        before = (case.status, case.severity, case.due_date, case.assigned_to_id, case.closed_at, case.resolution)
        count = db.query(Notification).count()
    result = save(client, headers, cid, proposal, preview)
    assert result.status_code == 200 and result.json() == {
        'success': True, 'case_id': cid, 'title': 'Reviewed title', 'summary': 'Reviewed summary',
        'reviewed_fingerprint': preview['reviewed_fingerprint']}
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert (case.status, case.severity, case.due_date, case.assigned_to_id,
                case.closed_at, case.resolution) == before
        assert db.query(Notification).count() == count
        rows = db.query(AuditLog).filter_by(target_id=cid, action='case_details_reviewed').all()
        assert len(rows) == 1 and preview['reviewed_fingerprint'] in rows[0].detail
    assert save(client, headers, cid, proposal, preview).status_code == 409


@pytest.mark.parametrize('field,value', [('title', 'Elsewhere'), ('summary', 'Elsewhere'),
    ('status', 'investigating'), ('severity', 'low'), ('resolution', 'New resolution')])
def test_changed_saved_context_blocks_details(client, field, value):
    headers, cid, proposal, preview = setup(client)
    with _TestingSessionLocal() as db:
        setattr(db.get(Case, cid), field, value)
        db.commit()
    assert save(client, headers, cid, proposal, preview).status_code == 409


def test_changed_proposal_blocks_and_clear_summary_is_explicit(client):
    headers, cid, proposal, preview = setup(client)
    assert save(client, headers, cid, {**proposal, 'title': 'Different'}, preview).status_code == 409
    proposal['summary'] = '   '
    preview = client.post(f'/api/v1/cases/{cid}/details-review', headers=headers, json=proposal).json()
    assert preview['new_summary'] is None
    assert save(client, headers, cid, proposal, preview).json()['summary'] is None


@pytest.mark.parametrize('proposal', [{'title': '', 'summary': ''}, {'title': ' ', 'summary': ''},
    {'title': 'x' * 501, 'summary': ''}, {'title': 'x', 'summary': 'x' * 20001},
    {'title': 12, 'summary': ''}, {'title': 'x', 'summary': '', 'status': 'closed'}])
def test_invalid_details_fail_before_write(client, proposal):
    headers, cid, _, _ = setup(client)
    assert client.post(f'/api/v1/cases/{cid}/details-review', headers=headers, json=proposal).status_code == 422


def test_nonowner_and_assignee_cannot_preview_or_apply(client):
    from test_case_assignment import _user_id
    _headers, cid, proposal, preview = setup(client)
    other = _seed_case_actor(client, 'other@example.com')
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = _user_id(client, other)
        db.commit()
    assert client.post(f'/api/v1/cases/{cid}/details-review', headers=other, json=proposal).status_code == 404
    assert save(client, other, cid, proposal, preview).status_code == 404
