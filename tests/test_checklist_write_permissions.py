"""Reading a shared checklist must not confer checklist management permission."""
# ruff: noqa: F811
import pytest
from test_case_tasks import (  # noqa: F401
    _seed_checklist_actor,
    _setup,
    _share_org,
    _TestingSessionLocal,
    _user_id,
    client,
)

from backend.models.case import Case, CaseTask, CaseTimeline, CaseWatcher
from backend.models.response_plan import ResponsePlan


def team(client):
    owner, cid = _setup(client)
    editor = _seed_checklist_actor(client, "editor@example.com")
    worker = _seed_checklist_actor(client, "worker@example.com")
    watcher = _seed_checklist_actor(client, "watcher@example.com")
    ids = [_user_id(client, headers) for headers in [owner, editor, worker, watcher]]
    _share_org(*ids)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = ids[1]
        db.add(CaseWatcher(case_id=cid, user_id=ids[3]))
        db.commit()
    mine = client.post(f"/api/v1/cases/{cid}/tasks", headers=owner,
                       json={"title": "Assigned worker task", "assignee_id": ids[2]}).json()
    other = client.post(f"/api/v1/cases/{cid}/tasks", headers=owner,
                        json={"title": "Other checklist task"}).json()
    return cid, owner, editor, worker, watcher, mine, other, ids


@pytest.mark.parametrize("verb,path,body", [("post", "", {"title": "Injected task"}),
                                           ("patch", "/{task}", {"done": True}),
                                           ("patch", "/{task}", {"title": "Changed task"}),
                                           ("patch", "/{task}", {"due_date": "2027-01-05"}),
                                           ("patch", "/{task}", {"assignee_id": None}),
                                           ("delete", "/{task}", None)])
def test_watcher_keeps_read_access_but_cannot_write_checklist(client, verb, path, body):
    cid, _owner, _editor, _worker, watcher, mine, _other, _ids = team(client)
    assert client.get(f"/api/v1/cases/{cid}/tasks", headers=watcher).status_code == 200
    url = f"/api/v1/cases/{cid}/tasks" + path.format(task=mine["id"])
    kwargs = {"headers": watcher, **({"json": body} if body is not None else {})}
    assert getattr(client, verb)(url, **kwargs).status_code == 403
    with _TestingSessionLocal() as db:
        task = db.get(CaseTask, mine["id"])
        assert task.title == "Assigned worker task" and task.done is False and task.due_date is None
        assert db.query(CaseTask).count() == 2


@pytest.mark.parametrize("body", [{"done": True}, {"due_date": "2027-01-05"}, {"due_date": None}])
def test_task_assignee_can_edit_only_own_completion_and_due_date(client, body):
    cid, _owner, _editor, worker, _watcher, mine, other, _ids = team(client)
    url = f"/api/v1/cases/{cid}/tasks"
    assert client.patch(f'{url}/{mine["id"]}', headers=worker, json=body).status_code == 200
    assert client.patch(f'{url}/{other["id"]}', headers=worker, json=body).status_code == 403


@pytest.mark.parametrize("body", [{"title": "Renamed task"}, {"assignee_id": None},
                                  {"done": True, "title": "Partial write must not happen"}])
def test_task_assignee_cannot_rename_reassign_or_smuggle_management_fields(client, body):
    cid, _owner, _editor, worker, _watcher, mine, _other, _ids = team(client)
    assert client.patch(f'/api/v1/cases/{cid}/tasks/{mine["id"]}', headers=worker, json=body).status_code == 403
    with _TestingSessionLocal() as db:
        assert db.get(CaseTask, mine["id"]).done is False
        assert db.get(CaseTask, mine["id"]).title == mine["title"]
        assert db.query(CaseTimeline).filter(CaseTimeline.content.like("Task completed:%")).count() == 0


def test_task_assignee_cannot_create_delete_or_seed_tasks(client):
    cid, _owner, _editor, worker, _watcher, mine, _other, ids = team(client)
    with _TestingSessionLocal() as db:
        plan = ResponsePlan(user_id=ids[2], case_id=cid, status="draft", actions=[{"action_type": "Review"}])
        db.add(plan)
        db.commit()
        pid = plan.id
    assert client.post(f'/api/v1/cases/{cid}/tasks', headers=worker, json={"title": "New"}).status_code == 403
    assert client.delete(f'/api/v1/cases/{cid}/tasks/{mine["id"]}', headers=worker).status_code == 403
    assert client.post(f'/api/v1/cases/{cid}/tasks/from-plan/{pid}', headers=worker).status_code == 403
    assert client.get(f'/api/v1/cases/{cid}/tasks/from-plan/{pid}/preview', headers=worker).status_code == 200


@pytest.mark.parametrize("manager_index", [1, 2])
def test_owner_and_case_assignee_keep_full_checklist_management(client, manager_index):
    data = team(client)
    cid, manager, mine = data[0], data[manager_index], data[5]
    created = client.post(f'/api/v1/cases/{cid}/tasks', headers=manager, json={"title": "Manager-added"})
    assert created.status_code == 201
    changed = client.patch(f'/api/v1/cases/{cid}/tasks/{mine["id"]}', headers=manager,
                           json={"title": "Manager-renamed", "done": True, "assignee_id": None})
    assert changed.status_code == 200 and changed.json()["done"] is True
    assert client.delete(f'/api/v1/cases/{cid}/tasks/{created.json()["id"]}', headers=manager).status_code == 204


def test_removed_assignment_does_not_leave_write_access_via_watching(client):
    cid, _owner, _editor, worker, _watcher, mine, _other, ids = team(client)
    with _TestingSessionLocal() as db:
        db.get(CaseTask, mine["id"]).assignee_id = None
        db.add(CaseWatcher(case_id=cid, user_id=ids[2]))
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}/tasks', headers=worker).status_code == 200
    assert client.patch(f'/api/v1/cases/{cid}/tasks/{mine["id"]}', headers=worker,
                        json={"done": True}).status_code == 403


def test_watcher_cannot_import_even_a_plan_they_own(client):
    cid, _owner, _editor, _worker, watcher, _mine, _other, ids = team(client)
    with _TestingSessionLocal() as db:
        plan = ResponsePlan(user_id=ids[3], case_id=cid, status="draft", actions=[{"action_type": "Review"}])
        db.add(plan)
        db.commit()
        pid = plan.id
    preview = client.get(f'/api/v1/cases/{cid}/tasks/from-plan/{pid}/preview', headers=watcher)
    assert preview.status_code == 200
    path = f'/api/v1/cases/{cid}/tasks/from-plan/{pid}'
    assert client.post(path, headers=watcher).status_code == 403
    assert client.post(path, headers=watcher, json={
        "reviewed_fingerprint": preview.json()["review_fingerprint"], "action_indexes": [0],
    }).status_code == 403
    with _TestingSessionLocal() as db:
        assert db.query(CaseTask).count() == 2
