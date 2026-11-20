"""Tests for case investigation task checklists."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_tasks.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_tasks.db"
_async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_AsyncTestingSessionLocal = async_sessionmaker(
    bind=_async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def _override_get_db():
    try:
        db = _TestingSessionLocal()
        yield db
    finally:
        db.close()


async def _override_get_async_db():
    async with _AsyncTestingSessionLocal() as session:
        yield session


@pytest.fixture
def client():
    Base.metadata.create_all(bind=_engine)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


def _register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    reg = client.post("/api/v1/auth/register", json={
        "email": email, "password": password, "full_name": "Analyst",
    })
    assert reg.status_code in (200, 201), f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email, "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _user_id(client: TestClient, headers) -> int:
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _make_case(user_id: int, title="Beaconing host") -> int:
    """Create a case owned by the given user and return its id."""
    with _TestingSessionLocal() as db:
        case = Case(user_id=user_id, title=title, status="open", severity="high")
        db.add(case)
        db.commit()
        db.refresh(case)
        return case.id


def _setup(client, email="owner@example.com"):
    headers = _register_and_login(client, email)
    case_id = _make_case(_user_id(client, headers))
    return headers, case_id


def test_create_and_list_tasks_in_order(client):
    headers, case_id = _setup(client)
    first = client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=headers)
    assert first.status_code == 201, first.text
    second = client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "Collect triage image"}, headers=headers)
    assert second.status_code == 201, second.text

    listed = client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers)
    assert listed.status_code == 200, listed.text
    tasks = listed.json()
    assert [t["title"] for t in tasks] == ["Contain the host", "Collect triage image"]
    assert [t["position"] for t in tasks] == [0, 1]
    assert all(t["done"] is False for t in tasks)
    assert all(t["completed_at"] is None for t in tasks)


def test_blank_title_rejected(client):
    headers, case_id = _setup(client)
    resp = client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "   "}, headers=headers)
    assert resp.status_code == 422


def test_complete_and_reopen_task_records_timeline(client):
    headers, case_id = _setup(client)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=headers
    ).json()

    done = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"done": True}, headers=headers
    )
    assert done.status_code == 200, done.text
    assert done.json()["done"] is True
    assert done.json()["completed_at"] is not None

    detail = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    actions = [e["content"] for e in detail["timeline"] if e["entry_type"] == "action"]
    assert "Task completed: Contain the host" in actions

    reopened = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"done": False}, headers=headers
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["done"] is False
    assert reopened.json()["completed_at"] is None

    detail = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    actions = [e["content"] for e in detail["timeline"] if e["entry_type"] == "action"]
    assert "Task reopened: Contain the host" in actions


def test_rename_task(client):
    headers, case_id = _setup(client)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Old title"}, headers=headers
    ).json()
    renamed = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"title": "New title"}, headers=headers
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "New title"
    blank = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"title": " "}, headers=headers
    )
    assert blank.status_code == 422


def test_delete_task(client):
    headers, case_id = _setup(client)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Throwaway"}, headers=headers
    ).json()
    deleted = client.delete(f"/api/v1/cases/{case_id}/tasks/{task['id']}", headers=headers)
    assert deleted.status_code == 204
    listed = client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json()
    assert listed == []


def test_task_from_another_case_not_found(client):
    headers, case_id = _setup(client)
    other_case_id = _make_case(_user_id(client, headers), title="Second case")
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Scoped"}, headers=headers
    ).json()
    resp = client.patch(
        f"/api/v1/cases/{other_case_id}/tasks/{task['id']}", json={"done": True}, headers=headers
    )
    assert resp.status_code == 404
    resp = client.delete(f"/api/v1/cases/{other_case_id}/tasks/{task['id']}", headers=headers)
    assert resp.status_code == 404


def test_tasks_hidden_from_users_without_case_access(client):
    _headers, case_id = _setup(client)
    outsider = _register_and_login(client, "outsider@example.com")
    for method in ("get", "post"):
        resp = getattr(client, method)(
            f"/api/v1/cases/{case_id}/tasks",
            headers=outsider,
            **({"json": {"title": "Nope"}} if method == "post" else {}),
        )
        assert resp.status_code == 404, resp.text


PLAN_ACTIONS = [
    {"action_type": "block_ip", "target": "10.0.4.9", "reason": "C2 traffic", "priority": 2},
    {"action_type": "isolate_host", "target": "eng-ws-04", "reason": "containment", "priority": 1},
    {"action_type": "notify", "target": "soc-oncall", "reason": "awareness", "priority": 3},
]


def _seed_plan(case_id: int, user_id: int, actions=None) -> int:
    from backend.models.response_plan import ResponsePlan
    with _TestingSessionLocal() as db:
        plan = ResponsePlan(
            case_id=case_id, user_id=user_id,
            actions=PLAN_ACTIONS if actions is None else actions,
            status="approved", autonomy_level="L1",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan.id


def test_seed_tasks_from_plan_in_priority_order(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))

    resp = client.post(f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}", headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["skipped"] == 0
    assert [t["title"] for t in body["created"]] == [
        "isolate_host: eng-ws-04", "block_ip: 10.0.4.9", "notify: soc-oncall",
    ]

    listed = client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json()
    assert [t["title"] for t in listed] == [
        "isolate_host: eng-ws-04", "block_ip: 10.0.4.9", "notify: soc-oncall",
    ]

    detail = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    actions = [e["content"] for e in detail["timeline"] if e["entry_type"] == "action"]
    assert f"Checklist seeded from response plan #{plan_id}: 3 tasks" in actions


def test_seed_tasks_from_plan_skips_existing(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "block_ip: 10.0.4.9"}, headers=headers)

    resp = client.post(f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}", headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["skipped"] == 1
    assert [t["title"] for t in body["created"]] == ["isolate_host: eng-ws-04", "notify: soc-oncall"]


def test_seed_tasks_from_plan_rejects_other_cases_plan(client):
    headers, case_id = _setup(client)
    other_case = _make_case(_user_id(client, headers), title="Other case")
    plan_id = _seed_plan(other_case, _user_id(client, headers))
    resp = client.post(f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}", headers=headers)
    assert resp.status_code == 404


def test_seed_tasks_hidden_from_users_without_case_access(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    outsider = _register_and_login(client, "outsider@example.com")
    resp = client.post(f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}", headers=outsider)
    assert resp.status_code == 404


def _share_org(*user_ids: int) -> None:
    """Put the given users into one organization."""
    from backend.models.organization import Organization
    with _TestingSessionLocal() as db:
        org = Organization(name="Task SOC", slug="task-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for uid in user_ids:
            db.get(User, uid).org_id = org.id
        db.commit()


def test_assign_task_to_org_member_on_create(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _make_case(owner_id)

    created = client.post(
        f"/api/v1/cases/{case_id}/tasks",
        json={"title": "Contain the host", "assignee_id": member_id},
        headers=owner,
    )
    assert created.status_code == 201, created.text
    assert created.json()["assignee_id"] == member_id


def test_reassign_and_unassign_task_records_timeline(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _make_case(owner_id)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=owner
    ).json()

    assigned = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": member_id}, headers=owner
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignee_id"] == member_id

    detail = client.get(f"/api/v1/cases/{case_id}", headers=owner).json()
    actions = [e["content"] for e in detail["timeline"] if e["entry_type"] == "action"]
    assert "Task assigned to member@example.com: Contain the host" in actions

    unassigned = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": None}, headers=owner
    )
    assert unassigned.status_code == 200, unassigned.text
    assert unassigned.json()["assignee_id"] is None

    detail = client.get(f"/api/v1/cases/{case_id}", headers=owner).json()
    actions = [e["content"] for e in detail["timeline"] if e["entry_type"] == "action"]
    assert "Task unassigned: Contain the host" in actions


def test_assign_task_unknown_user_returns_400(client):
    headers, case_id = _setup(client)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=headers
    ).json()
    resp = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": 99999}, headers=headers
    )
    assert resp.status_code == 400, resp.text


def test_assign_task_outside_org_returns_400(client):
    owner = _register_and_login(client, "owner@example.com")
    outsider = _register_and_login(client, "outsider@example.com")
    owner_id = _user_id(client, owner)
    outsider_id = _user_id(client, outsider)
    other_org = _register_and_login(client, "third@example.com")
    third_id = _user_id(client, other_org)
    _share_org(owner_id, third_id)  # owner has an org; the outsider is not in it
    case_id = _make_case(owner_id)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=owner
    ).json()
    resp = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": outsider_id}, headers=owner
    )
    assert resp.status_code == 400, resp.text


def test_omitting_assignee_leaves_it_untouched(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _make_case(owner_id)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks",
        json={"title": "Contain the host", "assignee_id": member_id},
        headers=owner,
    ).json()
    toggled = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"done": True}, headers=owner
    )
    assert toggled.status_code == 200, toggled.text
    assert toggled.json()["assignee_id"] == member_id


def test_assigning_a_task_notifies_the_assignee(client):
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _make_case(owner_id)
    task = client.post(
        f"/api/v1/cases/{case_id}/tasks", json={"title": "Contain the host"}, headers=owner
    ).json()

    resp = client.patch(
        f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": member_id}, headers=owner
    )
    assert resp.status_code == 200, resp.text
    inbox = client.get("/api/v1/notifications/", headers=member).json()
    kinds = [n["kind"] for n in inbox["data"]]
    assert "case_task_assigned" in kinds

    # Self-assignment and re-assigning the same person stay quiet.
    client.patch(f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": member_id}, headers=owner)
    client.patch(f"/api/v1/cases/{case_id}/tasks/{task['id']}", json={"assignee_id": owner_id}, headers=owner)
    inbox = client.get("/api/v1/notifications/", headers=member).json()
    notifs = inbox["data"]
    assert sum(1 for n in notifs if n["kind"] == "case_task_assigned") == 1
    owner_inbox = client.get("/api/v1/notifications/", headers=owner).json()
    owner_notifs = owner_inbox["data"]
    assert not any(n["kind"] == "case_task_assigned" for n in owner_notifs)


def _make_case_for(user_id: int, title: str, severity: str = "medium", status: str = "open",
                   due_date=None) -> int:
    with _TestingSessionLocal() as db:
        case = Case(user_id=user_id, title=title, status=status, severity=severity, due_date=due_date)
        db.add(case)
        db.commit()
        db.refresh(case)
        return case.id


class TestMyTasks:
    def _setup_team(self, client):
        owner = _register_and_login(client, "owner@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        _share_org(owner_id, member_id)
        return owner, member, owner_id, member_id

    def _assign(self, client, headers, case_id, title, assignee_id):
        created = client.post(
            f"/api/v1/cases/{case_id}/tasks",
            json={"title": title, "assignee_id": assignee_id},
            headers=headers,
        )
        assert created.status_code == 201, created.text
        return created.json()["id"]

    def test_lists_open_assigned_tasks_with_case_context(self, client):
        owner, member, owner_id, member_id = self._setup_team(client)
        low_case = _make_case_for(owner_id, "Low priority case", severity="low")
        crit_case = _make_case_for(owner_id, "Critical breach", severity="critical")
        self._assign(client, owner, low_case, "Review firewall logs", member_id)
        self._assign(client, owner, crit_case, "Contain the host", member_id)

        resp = client.get("/api/v1/cases/my-tasks", headers=member)
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert [r["title"] for r in rows] == ["Contain the host", "Review firewall logs"]
        first = rows[0]
        assert first["case_id"] == crit_case
        assert first["case_title"] == "Critical breach"
        assert first["case_severity"] == "critical"
        assert first["task_id"]

    def test_done_tasks_and_closed_cases_drop_out(self, client):
        owner, member, owner_id, member_id = self._setup_team(client)
        open_case = _make_case_for(owner_id, "Open case", severity="high")
        closed_case = _make_case_for(owner_id, "Closed case", severity="critical", status="closed")
        done_task = self._assign(client, owner, open_case, "Already finished", member_id)
        self._assign(client, owner, open_case, "Still open", member_id)
        self._assign(client, owner, closed_case, "On a closed case", member_id)
        client.patch(
            f"/api/v1/cases/{open_case}/tasks/{done_task}", json={"done": True}, headers=owner
        )

        rows = client.get("/api/v1/cases/my-tasks", headers=member).json()
        assert [r["title"] for r in rows] == ["Still open"]

    def test_only_the_assignee_sees_the_task(self, client):
        owner, member, owner_id, member_id = self._setup_team(client)
        case_id = _make_case_for(owner_id, "Open case", severity="high")
        self._assign(client, owner, case_id, "Member task", member_id)
        self._assign(client, owner, case_id, "Owner task", owner_id)

        member_rows = client.get("/api/v1/cases/my-tasks", headers=member).json()
        assert [r["title"] for r in member_rows] == ["Member task"]
        owner_rows = client.get("/api/v1/cases/my-tasks", headers=owner).json()
        assert [r["title"] for r in owner_rows] == ["Owner task"]

    def test_requires_auth(self, client):
        assert client.get("/api/v1/cases/my-tasks").status_code == 401


def test_task_assignee_can_open_the_case(client):
    """A member assigned a task on a case may open that case (the link in
    their assignment notification must not 404)."""
    owner = _register_and_login(client, "owner@example.com")
    member = _register_and_login(client, "member@example.com")
    owner_id = _user_id(client, owner)
    member_id = _user_id(client, member)
    _share_org(owner_id, member_id)
    case_id = _make_case(owner_id)
    client.post(
        f"/api/v1/cases/{case_id}/tasks",
        json={"title": "Contain the host", "assignee_id": member_id},
        headers=owner,
    )

    detail = client.get(f"/api/v1/cases/{case_id}", headers=member)
    assert detail.status_code == 200, detail.text
    assert detail.json()["title"] == "Beaconing host"


class TestCaseTaskDueDates:
    def test_create_task_with_due_date(self, client):
        headers = _register_and_login(client, "due-owner@example.com")
        owner_id = _user_id(client, headers)
        other_headers = _register_and_login(client, "due-assignee@example.com")
        other_id = _user_id(client, other_headers)
        _share_org(owner_id, other_id)
        case_id = _make_case(owner_id)
        resp = client.post(f"/api/v1/cases/{case_id}/tasks", json={
            "title": "Pull proxy logs",
            "assignee_id": other_id,
            "due_date": "2030-05-10",
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["due_date"] == "2030-05-10"
        assert data["assignee_id"] == other_id

    def test_create_task_due_date_defaults_null(self, client):
        headers, case_id = _setup(client)
        resp = client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "Triage"}, headers=headers)
        assert resp.status_code == 201
        assert resp.json()["due_date"] is None

    def test_update_due_date_set_change_and_clear(self, client):
        headers, case_id = _setup(client)
        task = client.post(
            f"/api/v1/cases/{case_id}/tasks",
            json={"title": "Check firewall"}, headers=headers,
        ).json()
        url = f"/api/v1/cases/{case_id}/tasks/{task['id']}"

        set_resp = client.patch(url, json={"due_date": "2030-06-01"}, headers=headers)
        assert set_resp.status_code == 200
        assert set_resp.json()["due_date"] == "2030-06-01"

        change_resp = client.patch(url, json={"due_date": "2030-07-15"}, headers=headers)
        assert change_resp.json()["due_date"] == "2030-07-15"

        clear_resp = client.patch(url, json={"due_date": None}, headers=headers)
        assert clear_resp.status_code == 200
        assert clear_resp.json()["due_date"] is None

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        texts = [t["content"] for t in detail["timeline"]]
        assert any("due date set to 2030-06-01" in t for t in texts)
        assert any("due date cleared" in t for t in texts)

    def test_omitted_due_date_is_untouched(self, client):
        headers, case_id = _setup(client)
        task = client.post(
            f"/api/v1/cases/{case_id}/tasks",
            json={"title": "Review", "due_date": "2030-01-20"}, headers=headers,
        ).json()
        resp = client.patch(
            f"/api/v1/cases/{case_id}/tasks/{task['id']}",
            json={"done": True}, headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["due_date"] == "2030-01-20"

    def test_list_tasks_returns_due_date(self, client):
        headers, case_id = _setup(client)
        client.post(f"/api/v1/cases/{case_id}/tasks", json={
            "title": "Dated", "due_date": "2030-03-03",
        }, headers=headers)
        tasks = client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json()
        assert tasks[-1]["due_date"] == "2030-03-03"

    def test_my_tasks_includes_task_due_date(self, client):
        headers, case_id = _setup(client)
        me_id = _user_id(client, headers)
        task = client.post(f"/api/v1/cases/{case_id}/tasks", json={
            "title": "Follow up with vendor",
            "assignee_id": me_id,
            "due_date": "2030-04-01",
        }, headers=headers).json()
        mine = client.get("/api/v1/cases/my-tasks", headers=headers).json()
        row = next(t for t in mine if t["task_id"] == task["id"])
        assert row["due_date"] == "2030-04-01"


def test_assigned_task_explorer_reaches_beyond_legacy_cap_with_global_filters(client):
    from backend.models.case import CaseTask
    headers, case_id = _setup(client)
    user_id = _user_id(client, headers)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=case_id, title=f"Work {i:03d}", position=i, assignee_id=user_id,
                            due_date=date(2026, 11, 20) if i == 209 else None, done=False)
                    for i in range(210)])
        db.commit()
    path = "/api/v1/cases/assigned-task-explorer"
    response = client.get(path, params={"page": 9, "size": 25, "today": "2026-11-21"}, headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 210 and data["page"] == 9 and data["size"] == 25
    assert len(data["data"]) == 10
    found = client.get(path, params={"query": "Work 209", "today": "2026-11-21"}, headers=headers).json()
    assert found["total"] == 1 and found["data"][0]["title"] == "Work 209"
    due = client.get(path, params={"due": "overdue", "today": "2026-11-21"}, headers=headers).json()
    assert due["total"] == 1 and due["data"][0]["title"] == "Work 209"
    assert len(client.get("/api/v1/cases/my-tasks", headers=headers).json()) == 200


def test_assigned_task_explorer_keeps_owner_open_case_and_literal_search_scope(client):
    from backend.models.case import CaseTask
    headers, case_id = _setup(client)
    user_id = _user_id(client, headers)
    outsider = _register_and_login(client, "task-explorer@example.com")
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=case_id, title="100%_literal", position=0, assignee_id=user_id, done=False),
                    CaseTask(case_id=case_id, title="100different", position=1, assignee_id=user_id, done=False),
                    CaseTask(case_id=case_id, title="Completed", position=2, assignee_id=user_id, done=True)])
        db.commit()
    path = "/api/v1/cases/assigned-task-explorer"
    assert client.get(path, headers=outsider).json()["total"] == 0
    assert client.get(path, headers=headers).json()["total"] == 2
    literal = client.get(path, params={"query": "%_"}, headers=headers).json()
    assert literal["total"] == 1 and literal["data"][0]["title"] == "100%_literal"
    assert client.get(path, params={"severity": "low"}, headers=headers).json()["total"] == 0
    with _TestingSessionLocal() as db:
        db.get(Case, case_id).status = "resolved"
        db.commit()
    assert client.get(path, headers=headers).json()["total"] == 0


@pytest.mark.parametrize("params", [{"page": 0}, {"size": 101}, {"due": "overdue"},
                                    {"due": "unknown"}, {"today": "2026-02-30"}, {"severity": "unknown"}])
def test_assigned_task_explorer_rejects_invalid_filters(client, params):
    headers, _case_id = _setup(client)
    response = client.get("/api/v1/cases/assigned-task-explorer", params=params, headers=headers)
    assert response.status_code == 422


def test_my_tasks_prioritizes_before_applying_return_limit(client):
    """A critical task inserted after 200 low-priority tasks must not disappear."""
    from datetime import date

    from backend.models.case import CaseTask

    headers = _register_and_login(client, "cap-owner@example.com")
    uid = _user_id(client, headers)
    with _TestingSessionLocal() as db:
        low = Case(user_id=uid, title="Low priority", status="open", severity="low")
        critical = Case(user_id=uid, title="Critical later case", status="open", severity="critical")
        db.add_all([low, critical])
        db.flush()
        db.add_all([CaseTask(case_id=low.id, title=f"Low task {i}", assignee_id=uid,
                             position=i, done=False) for i in range(205)])
        db.flush()
        db.add(CaseTask(case_id=critical.id, title="Critical inserted last", assignee_id=uid,
                        position=0, done=False, due_date=date(2030, 1, 1)))
        db.commit()
    first = client.get("/api/v1/cases/my-tasks", headers=headers)
    assert first.status_code == 200, first.text
    rows = first.json()
    assert len(rows) == 200
    assert rows[0]["title"] == "Critical inserted last"
    assert rows[1]["title"] == "Low task 0"
    assert rows[-1]["title"] == "Low task 198"
    repeated = client.get("/api/v1/cases/my-tasks", headers=headers).json()
    assert [row["task_id"] for row in repeated] == [row["task_id"] for row in rows]


def test_preview_selected_checklist_import_is_read_only_and_version_bound(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    preview = client.get(path + "/preview", headers=headers)
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert [row["action_index"] for row in data["proposals"]] == [1, 0, 2]
    assert client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json() == []
    payload = {"reviewed_fingerprint": data["review_fingerprint"], "action_indexes": [0, 2]}
    added = client.post(path, json=payload, headers=headers)
    assert added.status_code == 201, added.text
    assert [row["title"] for row in added.json()["created"]] == ["block_ip: 10.0.4.9", "notify: soc-oncall"]
    assert all(not row["done"] for row in added.json()["created"])
    again = client.post(path, json=payload, headers=headers)
    assert again.json()["created"] == [] and again.json()["skipped"] == 2
    from backend.models.response_plan import ResponsePlan
    with _TestingSessionLocal() as db:
        saved = db.get(ResponsePlan, plan_id)
        assert saved.status == "approved"
        saved.actions = [*PLAN_ACTIONS, {"action_type": "notify", "target": "new"}]
        db.commit()
    stale = client.post(path, json=payload, headers=headers)
    assert stale.status_code == 409
    assert len(client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json()) == 2


def test_checklist_preview_labels_existing_duplicate_and_malformed_actions(client):
    headers, case_id = _setup(client)
    actions = [{"action_type": "notify", "target": "soc", "priority": 0},
               {"action_type": "notify", "target": "soc", "priority": "high"},
               None, {"action_type": {"legacy": "object"}},
               {"action_type": "inspect", "reason": {"toString": "data"}}]
    plan_id = _seed_plan(case_id, _user_id(client, headers), actions)
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    rows = client.get(path + "/preview", headers=headers).json()["proposals"]
    assert rows[0]["priority"] == 0 and rows[0]["available"]
    assert rows[1]["already_present"] and not rows[1]["available"]
    assert not rows[2]["available"] and not rows[3]["available"]
    assert rows[4]["reason"] == '{"toString": "data"}'
    client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "notify: soc"}, headers=headers)
    fresh = client.get(path + "/preview", headers=headers).json()
    assert not fresh["proposals"][0]["available"]
    invalid = client.post(path, json={"reviewed_fingerprint": fresh["review_fingerprint"],
                                      "action_indexes": [2]}, headers=headers)
    assert invalid.status_code == 400


@pytest.mark.parametrize("indexes", [[], [0, 0], [-1], [99], [True], ["0"]])
def test_selected_checklist_import_rejects_invalid_indexes(client, indexes):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    fingerprint = client.get(path + "/preview", headers=headers).json()["review_fingerprint"]
    response = client.post(path, json={"reviewed_fingerprint": fingerprint, "action_indexes": indexes}, headers=headers)
    assert response.status_code == 422
    assert client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json() == []


def test_checklist_preview_preserves_case_visibility_and_plan_case_binding(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    outsider = _register_and_login(client, "preview-outsider@example.com")
    assert client.get(f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}/preview", headers=outsider).status_code == 404
    other_case = _make_case(_user_id(client, headers))
    response = client.get(f"/api/v1/cases/{other_case}/tasks/from-plan/{plan_id}/preview", headers=headers)
    assert response.status_code == 404


def test_checklist_preview_does_not_disclose_another_plan_owners_evidence(client):
    headers, case_id = _setup(client)
    other = _register_and_login(client, "plan-owner@example.com")
    plan_id = _seed_plan(case_id, _user_id(client, other))
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    assert client.get(path + "/preview", headers=headers).status_code == 404
    selected = client.post(path, json={"reviewed_fingerprint": "a" * 64, "action_indexes": [0]}, headers=headers)
    assert selected.status_code == 404


def test_checklist_preview_rejects_oversized_plan_without_creating_tasks(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers), [PLAN_ACTIONS[0]] * 201)
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    assert client.get(path + "/preview", headers=headers).status_code == 400
    assert client.get(f"/api/v1/cases/{case_id}/tasks", headers=headers).json() == []


def test_reviewed_checklist_import_records_exact_created_task_provenance(client):
    headers, case_id = _setup(client)
    plan_id = _seed_plan(case_id, _user_id(client, headers))
    client.post(f"/api/v1/cases/{case_id}/tasks", json={"title": "block_ip: 10.0.4.9"}, headers=headers)
    path = f"/api/v1/cases/{case_id}/tasks/from-plan/{plan_id}"
    fingerprint = client.get(path + "/preview", headers=headers).json()["review_fingerprint"]
    result = client.post(path, json={"reviewed_fingerprint": fingerprint, "action_indexes": [0, 1]}, headers=headers)
    assert result.status_code == 201, result.text
    created = result.json()["created"]
    assert len(created) == 1
    detail = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
    entry = next(row for row in detail["timeline"]
                 if (row.get("metadata_json") or {}).get("kind") == "reviewed_checklist_import")
    record = entry["metadata_json"]
    assert record["reviewed_fingerprint"] == fingerprint
    assert record["case_id"] == case_id and record["plan_id"] == plan_id
    assert record["selected_action_indexes"] == [0, 1]
    assert record["skipped_existing_titles"] == 1
    assert record["created_tasks"] == [{"task_id": created[0]["id"], "action_index": 1,
                                         "title_at_import": "isolate_host: eng-ws-04"}]
    client.patch(f"/api/v1/cases/{case_id}/tasks/{created[0]['id']}",
                 json={"title": "Renamed", "done": True}, headers=headers)
    saved = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()["timeline"]
    retained = next(row for row in saved if row["id"] == entry["id"])
    assert retained["metadata_json"] == record
    repeat = client.post(path, json={"reviewed_fingerprint": fingerprint, "action_indexes": [0]}, headers=headers)
    assert repeat.json()["created"] == []
    final = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()["timeline"]
    assert sum((row.get("metadata_json") or {}).get("kind") == "reviewed_checklist_import" for row in final) == 1


def test_assigned_task_history_keeps_legacy_default_and_requires_explicit_scopes(client):
    from datetime import UTC, datetime

    from backend.models.case import CaseTask

    headers, case_id = _setup(client)
    uid = _user_id(client, headers)
    with _TestingSessionLocal() as db:
        inactive = Case(user_id=uid, title="Resolved investigation", status="resolved", severity="high")
        db.add(inactive)
        db.flush()
        inactive_id = inactive.id
        db.add_all([CaseTask(case_id=case_id, title="Open active", position=0, assignee_id=uid, done=False),
                    CaseTask(case_id=case_id, title="Completed active", position=1, assignee_id=uid, done=True,
                             completed_at=datetime(2026, 11, 20, 18, 0, tzinfo=UTC)),
                    CaseTask(case_id=inactive.id, title="Open inactive", position=2, assignee_id=uid, done=False),
                    CaseTask(case_id=inactive.id, title="Completed inactive", position=3, assignee_id=uid, done=True,
                             due_date=date(2026, 11, 19))])
        db.commit()
    path = "/api/v1/cases/assigned-task-explorer"
    default = client.get(path, headers=headers).json()
    assert default["completion"] == "open" and default["investigations"] == "active"
    assert [row["title"] for row in default["data"]] == ["Open active"]
    assert [row["title"] for row in client.get("/api/v1/cases/my-tasks", headers=headers).json()] == ["Open active"]
    completed = client.get(path, params={"completion": "completed"}, headers=headers).json()
    assert completed["total"] == 1 and completed["data"][0]["done"] is True
    assert completed["data"][0]["completed_at"].startswith("2026-11-20T18:00:00")
    inactive = client.get(path, params={"completion": "all", "investigations": "inactive"}, headers=headers).json()
    assert inactive["total"] == 2 and {row["case_id"] for row in inactive["data"]} == {inactive_id}
    dated = client.get(path, params={"completion": "completed", "investigations": "inactive",
                                     "due": "overdue", "today": "2026-11-21"}, headers=headers).json()
    assert dated["total"] == 1 and dated["data"][0]["title"] == "Completed inactive"
    assert dated["data"][0]["completed_at"] is None  # Do not invent a timestamp for older records.
    all_tasks = client.get(path, params={"completion": "all", "investigations": "all", "size": 1, "page": 4},
                           headers=headers).json()
    assert all_tasks["total"] == 4 and len(all_tasks["data"]) == 1
    assert "Not assignment history" in all_tasks["scope"]


def test_assigned_task_history_does_not_leak_other_assignees_or_removed_assignments(client):
    from backend.models.case import CaseTask

    headers, case_id = _setup(client)
    uid = _user_id(client, headers)
    other = _register_and_login(client, "task-history-other@example.com")
    other_id = _user_id(client, other)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=case_id, title="Own current assignment", position=0, assignee_id=uid, done=True),
                    CaseTask(case_id=case_id, title="Another assignee", position=1, assignee_id=other_id, done=True),
                    CaseTask(case_id=case_id, title="Unassigned old work", position=2, assignee_id=None, done=True)])
        db.get(Case, case_id).status = "closed"
        db.commit()
    path = "/api/v1/cases/assigned-task-explorer"
    params = {"completion": "all", "investigations": "all"}
    own_rows = client.get(path, params=params, headers=headers).json()["data"]
    other_rows = client.get(path, params=params, headers=other).json()["data"]
    assert [row["title"] for row in own_rows] == ["Own current assignment"]
    assert [row["title"] for row in other_rows] == ["Another assignee"]


@pytest.mark.parametrize("params", [{"completion": "unknown"}, {"investigations": "unknown"}])
def test_assigned_task_history_rejects_invalid_scope(client, params):
    headers, _ = _setup(client)
    assert client.get("/api/v1/cases/assigned-task-explorer", params=params, headers=headers).status_code == 422
