"""Close-out is a reviewed workflow state, not completion of underlying work."""
# ruff: noqa: F811
from datetime import date

import pytest
from test_case_tasks import (  # noqa: F401
    _register_and_login,
    _setup,
    _TestingSessionLocal,
    _user_id,
    client,
)

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert, CaseTask, CaseWatcher


def setup_review(client):
    headers, cid = _setup(client)
    uid = _user_id(client, headers)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).resolution = "Saved initial resolution"
        db.add_all([CaseTask(case_id=cid, title="Open follow-up", done=False, position=0),
                    CaseTask(case_id=cid, title="Finished follow-up", done=True, position=1)])
        asset = Asset(user_id=uid, name="Reviewed gateway", asset_type="hardware")
        db.add(asset)
        db.flush()
        alert = Alert(user_id=uid, asset_id=asset.id, title="Active linked finding", status="pending", severity="high")
        resolved = Alert(user_id=uid, asset_id=asset.id, title="Resolved linked finding",
                         status="resolved", severity="low")
        db.add_all([alert, resolved])
        db.flush()
        db.add_all([CaseAlert(case_id=cid, alert_id=alert.id), CaseAlert(case_id=cid, alert_id=resolved.id)])
        db.commit()
    preview = client.get(f"/api/v1/cases/{cid}/closeout-review", headers=headers,
                         params={"target_status": "resolved"})
    assert preview.status_code == 200, preview.text
    return headers, cid, uid, preview.json()


def save(client, headers, cid, preview, **extra):
    return client.patch(f"/api/v1/cases/{cid}", headers=headers, params={
        "status_update": "resolved", "reviewed_fingerprint": preview["reviewed_fingerprint"], **extra})


def test_preview_is_read_only_and_separates_open_work_from_completed_records(client):
    _headers, cid, _uid, preview = setup_review(client)
    assert preview["case_id"] == cid and preview["target_status"] == "resolved" and preview["status"] == "open"
    assert preview["task_total"] == 2 and len(preview["open_tasks"]) == 1
    assert preview["open_tasks"][0]["title"] == "Open follow-up"
    assert preview["alert_total"] == 2 and len(preview["remaining_alerts"]) == 1
    assert preview["remaining_alerts"][0]["title"] == "Active linked finding"
    assert preview["can_edit_resolution"] is True and preview["unavailable_alert_links"] == 0
    with _TestingSessionLocal() as db:
        assert db.get(Case, cid).status == "open" and db.get(Case, cid).closed_at is None


def test_confirmed_closeout_changes_only_case_status_and_reviewed_resolution(client):
    headers, cid, _uid, preview = setup_review(client)
    response = save(client, headers, cid, preview, resolution="  Scoped outcome; follow-up remains  ")
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["success"] is True and value["data"]["status"] == "resolved"
    assert value["data"]["reviewed_fingerprint"] == preview["reviewed_fingerprint"]
    assert value["data"]["case_id"] == cid and value["data"]["closed_at"]
    assert value["data"]["resolution"] == "Scoped outcome; follow-up remains"
    with _TestingSessionLocal() as db:
        assert db.query(CaseTask).filter_by(case_id=cid, done=False).count() == 1
        assert db.query(Alert).filter_by(status="pending").count() == 1
    assert save(client, headers, cid, preview).status_code == 409


@pytest.mark.parametrize("change", ["case_title", "status", "resolution", "case_due", "task_done", "task_title",
                                   "task_assignee", "new_task", "alert_status", "new_link", "unlink"])
def test_changed_case_or_work_invalidates_review_before_any_closeout_write(client, change):
    headers, cid, uid, preview = setup_review(client)
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        task = db.query(CaseTask).filter_by(case_id=cid, done=False).one()
        if change == "case_title":
            case.title = "Renamed investigation"
        elif change == "status":
            case.status = "investigating"
        elif change == "resolution":
            case.resolution = "Another saved outcome"
        elif change == "case_due":
            case.due_date = date(2027, 1, 5)
        elif change == "task_done":
            task.done = True
        elif change == "task_title":
            task.title = "Changed remaining work"
        elif change == "task_assignee":
            task.assignee_id = uid
        elif change == "new_task":
            db.add(CaseTask(case_id=cid, title="New task", done=False, position=5))
        elif change == "alert_status":
            db.get(Alert, preview["remaining_alerts"][0]["id"]).status = "acknowledged"
        elif change == "unlink":
            db.query(CaseAlert).filter_by(case_id=cid, alert_id=preview["remaining_alerts"][0]["id"]).delete()
        else:
            alert = Alert(user_id=uid, asset_id=db.query(Asset).filter_by(user_id=uid).first().id,
                          title="New linked alert", status="pending", severity="high")
            db.add(alert)
            db.flush()
            db.add(CaseAlert(case_id=cid, alert_id=alert.id))
        db.commit()
        old_status, old_resolution = case.status, case.resolution
    response = save(client, headers, cid, preview, resolution="Must not overwrite newer review")
    assert response.status_code == 409, response.text
    with _TestingSessionLocal() as db:
        case = db.get(Case, cid)
        assert case.status == old_status and case.resolution == old_resolution and case.closed_at is None


def test_closeout_scope_does_not_smuggle_other_edits_or_nonterminal_statuses(client):
    headers, cid, _uid, preview = setup_review(client)
    assert save(client, headers, cid, preview, severity="low").status_code == 422
    assert save(client, headers, cid, preview, status_update="open").status_code == 422
    assert save(client, headers, cid, preview, reviewed_fingerprint="bad").status_code == 422


def test_assignee_can_change_status_but_not_resolution_and_watcher_cannot_close(client):
    _headers, cid, _uid, _preview = setup_review(client)
    editor = _register_and_login(client, "editor@example.com")
    watcher = _register_and_login(client, "watcher@example.com")
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = _user_id(client, editor)
        db.add(CaseWatcher(case_id=cid, user_id=_user_id(client, watcher)))
        db.commit()
    url = f"/api/v1/cases/{cid}/closeout-review"
    response = client.get(url, headers=editor, params={"target_status": "resolved"})
    assert response.status_code == 200 and response.json()["can_edit_resolution"] is False
    assert save(client, editor, cid, response.json(), resolution="Forbidden").status_code == 403
    assert client.get(url, headers=watcher, params={"target_status": "resolved"}).status_code == 403
    assert save(client, watcher, cid, response.json()).status_code == 403
    assert save(client, editor, cid, response.json()).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(Case, cid).resolution == "Saved initial resolution"


def test_unavailable_foreign_alert_link_is_counted_without_disclosing_its_contents(client):
    headers, cid, _uid, _preview = setup_review(client)
    foreign = _register_and_login(client, "foreign@example.com")
    with _TestingSessionLocal() as db:
        alert = Alert(user_id=_user_id(client, foreign), asset_id=db.query(Asset).first().id,
                      title="Private foreign finding", status="pending", severity="high")
        db.add(alert)
        db.flush()
        db.add(CaseAlert(case_id=cid, alert_id=alert.id))
        db.commit()
    response = client.get(f"/api/v1/cases/{cid}/closeout-review", headers=headers, params={"target_status": "resolved"})
    assert response.json()["unavailable_alert_links"] == 1
    assert "Private foreign finding" not in response.text
    assert client.get(f"/api/v1/cases/{cid}/closeout-review", headers=foreign,
                      params={"target_status": "resolved"}).status_code == 404
