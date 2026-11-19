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
