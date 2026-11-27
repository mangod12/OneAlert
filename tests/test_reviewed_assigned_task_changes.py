"""Reviewed edits of any page of the current user's assigned workload."""
# ruff: noqa: F811
from datetime import date

import pytest
from test_case_tasks import (  # noqa: F401
    _seed_checklist_actor,
    _setup,
    _TestingSessionLocal,
    _user_id,
    client,
)

from backend.models.case import CaseTask, CaseTimeline


def setup_task(client, *, done=False, status="open"):
    headers, case_id = _setup(client)
    uid = _user_id(client, headers)
    response = client.post(f"/api/v1/cases/{case_id}/tasks", headers=headers,
                           json={"title": "Collect reviewed evidence", "assignee_id": uid, "due_date": "2026-11-23"})
    task = response.json()
    with _TestingSessionLocal() as db:
        row = db.get(CaseTask, task["id"])
        row.done = done
        from backend.models.case import Case
        db.get(Case, case_id).status = status
        db.commit()
    payload = {"case_id": case_id, "expected_title": task["title"], "expected_done": done,
               "expected_due_date": "2026-11-23", "expected_case_title": "Beaconing host",
               "expected_case_status": status, "action": "reopen" if done else "complete", "due_date": None}
    return headers, task, payload


def test_complete_and_reopen_exact_assigned_task_with_timeline(client):
    headers, task, payload = setup_task(client)
    url = f'/api/v1/cases/assigned-task-explorer/{task["id"]}'
    response = client.patch(url, headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["done"] is True and response.json()["completed_at"]
    assert response.json()["due_date"] == "2026-11-23"
    payload.update(expected_done=True, action="reopen")
    response = client.patch(url, headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["done"] is False and response.json()["completed_at"] is None
    with _TestingSessionLocal() as db:
        notes = [row.content for row in db.query(CaseTimeline).filter_by(case_id=task["case_id"]).all()]
    assert sum(note.startswith("Task completed:") for note in notes) == 1
    assert sum(note.startswith("Task reopened:") for note in notes) == 1


@pytest.mark.parametrize("action,new_date", [("set_due", "2027-01-05"), ("clear_due", None)])
def test_dates_do_not_reopen_completed_tasks_or_inactive_investigations(client, action, new_date):
    headers, task, payload = setup_task(client, done=True, status="closed")
    payload.update(action=action, due_date=new_date)
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["due_date"] == new_date and response.json()["done"] is True
    from backend.models.case import Case
    with _TestingSessionLocal() as db:
        assert db.get(Case, task["case_id"]).status == "closed"
        assert db.get(Case, task["case_id"]).due_date is None


@pytest.mark.parametrize("field,value", [("expected_title", "Old title"), ("expected_done", True),
                                         ("expected_due_date", None), ("expected_case_title", "Old investigation"),
                                         ("expected_case_status", "resolved")])
def test_changed_review_is_rejected_without_writing(client, field, value):
    headers, task, payload = setup_task(client)
    payload.update(action="set_due", due_date="2027-01-05")
    payload[field] = value
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 409, response.text
    with _TestingSessionLocal() as db:
        row = db.get(CaseTask, task["id"])
        assert not row.done and row.due_date == date(2026, 11, 23)
        assert not db.query(CaseTimeline).filter(CaseTimeline.content.like("Task due date set%2027%" )).count()


def test_reassignment_blocks_stale_owner_even_when_case_is_owned(client):
    headers, task, payload = setup_task(client)
    with _TestingSessionLocal() as db:
        db.get(CaseTask, task["id"]).assignee_id = None
        db.commit()
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 409


def test_foreign_task_and_unauthenticated_requests_cannot_mutate(client):
    _headers, task, payload = setup_task(client)
    other = _seed_checklist_actor(client, "other@example.com")
    url = f'/api/v1/cases/assigned-task-explorer/{task["id"]}'
    assert client.patch(url, headers=other, json=payload).status_code == 404
    client.cookies.clear()
    assert client.patch(url, json=payload).status_code == 401


@pytest.mark.parametrize("change", [{"action": "delete"}, {"expected_done": "false"}, {"case_id": True},
                                   {"action": "set_due"}, {"action": "complete", "due_date": "2026-12-01"},
                                   {"action": "clear_due", "assignee_id": 1}, {"due_date": "not-a-date"}])
def test_only_exact_reviewed_actions_and_typed_inputs_are_accepted(client, change):
    headers, task, payload = setup_task(client)
    payload.update(change)
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 422, response.text


def test_repeat_completion_is_not_duplicated(client):
    headers, task, payload = setup_task(client)
    url = f'/api/v1/cases/assigned-task-explorer/{task["id"]}'
    assert client.patch(url, headers=headers, json=payload).status_code == 200
    assert client.patch(url, headers=headers, json=payload).status_code == 409
    with _TestingSessionLocal() as db:
        assert db.query(CaseTimeline).filter(CaseTimeline.content.like("Task completed:%")).count() == 1


def test_an_assigned_task_beyond_the_first_200_can_be_changed(client):
    headers, task, payload = setup_task(client)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=task["case_id"], title=f"Unrelated checklist task {n}", position=n,
                             assignee_id=_user_id(client, headers), due_date=date(2026, 11, 22)) for n in range(201)])
        db.commit()
    first = client.get("/api/v1/cases/my-tasks", headers=headers).json()
    assert len(first) == 200 and task["id"] not in [row["task_id"] for row in first]
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 200
    with _TestingSessionLocal() as db:
        assert db.query(CaseTask).filter_by(done=True).count() == 1
        assert db.query(CaseTask).filter_by(done=False).count() == 201


def test_explicit_reopen_leaves_inactive_investigation_closed(client):
    headers, task, payload = setup_task(client, done=True, status="closed")
    response = client.patch(f'/api/v1/cases/assigned-task-explorer/{task["id"]}', headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()["done"] is False and response.json()["completed_at"] is None
    from backend.models.case import Case
    with _TestingSessionLocal() as db:
        assert db.get(Case, task["case_id"]).status == "closed"
