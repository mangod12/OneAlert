"""Tests for case investigation task checklists."""

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
    headers, case_id = _setup(client)
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
