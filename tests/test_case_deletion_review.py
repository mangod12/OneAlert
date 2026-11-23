"""Full deletion inventory must still match at the irreversible boundary."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, client

from backend.models.case import Case, CaseTask, CaseTimeline


def setup(client):
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    preview = client.get(f'/api/v1/cases/{cid}/deletion-review', headers=headers)
    assert preview.status_code == 200
    return headers, cid, preview.json()


def test_review_readonly_and_exact_removal(client):
    headers, cid, preview = setup(client)
    assert preview['case']['id'] == cid
    assert set(preview['inventory']) == {
        'tasks', 'watchers', 'alert_links', 'event_links', 'timeline', 'response_plans', 'approvals',
    }
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).status_code == 200
    response = client.delete(f'/api/v1/cases/{cid}', headers=headers,
                             params={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 204
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).status_code == 404


@pytest.mark.parametrize('change', ['title', 'task_added', 'note_added', 'wrong_digest'])
def test_inventory_change_never_deletes(client, change):
    headers, cid, preview = setup(client)
    with _TestingSessionLocal() as db:
        if change == 'title':
            db.get(Case, cid).title = 'Changed'
        elif change == 'task_added':
            db.add(CaseTask(case_id=cid, title='Unreviewed task'))
        elif change == 'note_added':
            db.add(CaseTimeline(case_id=cid, entry_type='note', content='Unreviewed note'))
        db.commit()
    digest = '0' * 64 if change == 'wrong_digest' else preview['reviewed_fingerprint']
    assert client.delete(f'/api/v1/cases/{cid}', headers=headers,
                         params={'reviewed_fingerprint': digest}).status_code == 409
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).status_code == 200


def test_nonowner_cannot_review_or_remove(client):
    _, cid, preview = setup(client)
    other = _register_and_login(client, 'other@example.com')
    assert client.get(f'/api/v1/cases/{cid}/deletion-review', headers=other).status_code == 404
    assert client.delete(f'/api/v1/cases/{cid}', headers=other,
                         params={'reviewed_fingerprint': preview['reviewed_fingerprint']}).status_code == 404


@pytest.mark.parametrize('digest', ['', 'x' * 64, 'a' * 63, 'a' * 65])
def test_invalid_digest_never_deletes(client, digest):
    headers, cid, _ = setup(client)
    assert client.delete(f'/api/v1/cases/{cid}', headers=headers,
                         params={'reviewed_fingerprint': digest}).status_code == 422


@pytest.mark.parametrize('change', ['task_edit', 'task_removed', 'watch', 'plan', 'approval'])
def test_dependent_mutations_invalidate_complete_review(client, change):
    from backend.models.case import CaseWatcher
    from backend.models.response_plan import ApprovalRequest, ResponsePlan
    headers, cid, _ = setup(client)
    with _TestingSessionLocal() as db:
        owner = db.get(Case, cid).user_id
        task = CaseTask(case_id=cid, title='Saved task')
        plan = ResponsePlan(case_id=cid, user_id=owner, actions=[{'action': 'block_ip'}])
        db.add_all([task, plan])
        db.flush()
        approval = ApprovalRequest(plan_id=plan.id, reason='Saved approval')
        db.add(approval)
        db.commit()
        tid, pid, aid = task.id, plan.id, approval.id
    preview = client.get(f'/api/v1/cases/{cid}/deletion-review', headers=headers).json()
    with _TestingSessionLocal() as db:
        if change == 'task_edit':
            db.get(CaseTask, tid).done = True
        elif change == 'task_removed':
            db.delete(db.get(CaseTask, tid))
        elif change == 'watch':
            db.add(CaseWatcher(case_id=cid, user_id=owner))
        elif change == 'plan':
            db.get(ResponsePlan, pid).actions = [{'action': 'isolate_host'}]
        else:
            db.get(ApprovalRequest, aid).reason = 'Changed approval'
        db.commit()
    response = client.delete(f'/api/v1/cases/{cid}', headers=headers,
                             params={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 409
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).status_code == 200


def test_over_limit_inventory_fails_closed(client):
    headers, cid, _ = setup(client)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=cid, title=f'Task {n}') for n in range(501)])
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}/deletion-review', headers=headers).status_code == 409


def test_reviewed_removal_removes_dependents_but_keeps_original_alert_and_audit(client):
    from backend.models.alert import Alert
    from backend.models.asset import Asset
    from backend.models.audit_log import AuditLog
    from backend.models.case import CaseAlert, CaseWatcher
    from backend.models.response_plan import ApprovalRequest, ResponsePlan
    headers, cid, _ = setup(client)
    with _TestingSessionLocal() as db:
        owner = db.get(Case, cid).user_id
        asset = Asset(user_id=owner, name='Original asset', asset_type='server')
        db.add(asset)
        db.flush()
        alert = Alert(asset_id=asset.id, user_id=owner, title='Original evidence', severity='high', status='pending')
        db.add(alert)
        db.flush()
        aid, asset_id = alert.id, asset.id
        db.add_all([CaseAlert(case_id=cid, alert_id=aid), CaseTask(case_id=cid, title='Saved task'),
                    CaseWatcher(case_id=cid, user_id=owner)])
        plan = ResponsePlan(case_id=cid, user_id=owner, actions=[{'action': 'block_ip'}])
        db.add(plan)
        db.flush()
        pid = plan.id
        db.add(ApprovalRequest(plan_id=pid, reason='Saved approval'))
        db.commit()
    preview = client.get(f'/api/v1/cases/{cid}/deletion-review', headers=headers).json()
    assert len(preview['inventory']['response_plans']) == len(preview['inventory']['approvals']) == 1
    response = client.delete(f'/api/v1/cases/{cid}', headers=headers,
                             params={'reviewed_fingerprint': preview['reviewed_fingerprint']})
    assert response.status_code == 204, response.text
    with _TestingSessionLocal() as db:
        assert db.get(Alert, aid).status == 'pending'
        assert db.get(Asset, asset_id) is not None
        assert db.query(CaseTask).filter_by(case_id=cid).count() == 0
        assert db.query(CaseWatcher).filter_by(case_id=cid).count() == 0
        assert db.query(CaseAlert).filter_by(case_id=cid).count() == 0
        assert db.get(ResponsePlan, pid) is None
        assert db.query(ApprovalRequest).filter_by(plan_id=pid).count() == 0
        log = db.query(AuditLog).filter_by(action='case_deletion_reviewed').one()
        assert preview['reviewed_fingerprint'] in log.detail
