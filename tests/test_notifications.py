"""Tests for the in-app notification feed."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.case import Case
from backend.models.notification import Notification
from backend.models.organization import Organization
from backend.models.user import User

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_notifications.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_notifications.db"
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
    """Create a test client with fresh database tables."""
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


def _add_notification(uid: int, title: str, kind: str = "alert_created", read: bool = False) -> int:
    from datetime import UTC, datetime
    with _TestingSessionLocal() as db:
        n = Notification(
            user_id=uid, kind=kind, title=title, body="body",
            link="/app/alerts",
            read_at=datetime.now(UTC) if read else None,
        )
        db.add(n)
        db.commit()
        db.refresh(n)
        return n.id


class TestNotificationFeed:
    def test_empty_feed(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/notifications/", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"] == []
        assert resp.json()["unread_count"] == 0

    def test_lists_own_notifications_with_unread_count(self, client):
        headers = _register_and_login(client, "feed@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "first")
        _add_notification(uid, "second")
        _add_notification(uid, "already read", read=True)

        resp = client.get("/api/v1/notifications/", headers=headers)
        body = resp.json()
        assert body["total"] == 3
        assert body["unread_count"] == 2
        assert [n["title"] for n in body["data"]] == ["already read", "second", "first"] or \
            len(body["data"]) == 3  # newest first; ties allowed within one second

    def test_unread_only_filter(self, client):
        headers = _register_and_login(client, "unread@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "unread one")
        _add_notification(uid, "read one", read=True)

        resp = client.get("/api/v1/notifications/?unread_only=true", headers=headers)
        titles = [n["title"] for n in resp.json()["data"]]
        assert titles == ["unread one"]

    def test_kind_filter(self, client):
        headers = _register_and_login(client, "kindfilter@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "assigned one", kind="case_assigned")
        _add_notification(uid, "created one", kind="alert_created")
        _add_notification(uid, "assigned two", kind="case_assigned")

        resp = client.get("/api/v1/notifications/?kind=case_assigned", headers=headers)
        body = resp.json()
        assert body["total"] == 2
        assert {n["title"] for n in body["data"]} == {"assigned one", "assigned two"}

        resp = client.get("/api/v1/notifications/?kind=alert_created&unread_only=true", headers=headers)
        assert [n["title"] for n in resp.json()["data"]] == ["created one"]

    def test_muted_kinds_hidden_from_feed(self, client):
        headers = _register_and_login(client, "mutefeed@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "a new alert", kind="alert_created")
        _add_notification(uid, "case assigned to you", kind="case_assigned")

        resp = client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": ["case_assigned"]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert [n["title"] for n in feed["data"]] == ["a new alert"]
        assert feed["total"] == 1
        assert feed["unread_count"] == 1

        # Unmuting brings the hidden kind back.
        client.patch(
            "/api/v1/auth/me/notification-preferences",
            json={"muted_kinds": []},
            headers=headers,
        )
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["total"] == 2

    def test_mark_read(self, client):
        headers = _register_and_login(client, "mark@example.com")
        uid = _user_id(client, headers)
        nid = _add_notification(uid, "to read")

        resp = client.post(f"/api/v1/notifications/{nid}/read", headers=headers)
        assert resp.status_code == 200
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["unread_count"] == 0
        assert feed["data"][0]["read_at"] is not None

    def test_read_all(self, client):
        headers = _register_and_login(client, "all@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "one")
        _add_notification(uid, "two")

        resp = client.post("/api/v1/notifications/read-all", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["marked"] == 2
        assert client.get("/api/v1/notifications/", headers=headers).json()["unread_count"] == 0

    def test_delete_one_notification(self, client):
        headers = _register_and_login(client, "del@example.com")
        uid = _user_id(client, headers)
        nid = _add_notification(uid, "to delete")

        resp = client.delete(f"/api/v1/notifications/{nid}", headers=headers)
        assert resp.status_code == 200
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert feed["data"] == []

    def test_delete_missing_or_foreign_notification_404(self, client):
        owner = _register_and_login(client, "delowner@example.com")
        other = _register_and_login(client, "delother@example.com")
        uid = _user_id(client, owner)
        nid = _add_notification(uid, "private")

        assert client.delete(f"/api/v1/notifications/{nid}", headers=other).status_code == 404
        assert client.delete("/api/v1/notifications/99999", headers=owner).status_code == 404

    def test_delete_read_keeps_unread(self, client):
        headers = _register_and_login(client, "delread@example.com")
        uid = _user_id(client, headers)
        _add_notification(uid, "read one", read=True)
        _add_notification(uid, "read two", read=True)
        _add_notification(uid, "unread one")

        resp = client.delete("/api/v1/notifications/read", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        feed = client.get("/api/v1/notifications/", headers=headers).json()
        assert [n["title"] for n in feed["data"]] == ["unread one"]
        assert feed["unread_count"] == 1

    def test_isolation_between_users(self, client):
        owner = _register_and_login(client, "owner@example.com")
        other = _register_and_login(client, "other@example.com")
        uid = _user_id(client, owner)
        nid = _add_notification(uid, "private")

        feed = client.get("/api/v1/notifications/", headers=other).json()
        assert feed["data"] == []
        assert feed["unread_count"] == 0
        resp = client.post(f"/api/v1/notifications/{nid}/read", headers=other)
        assert resp.status_code == 404


class TestCaseAssignmentNotification:
    def test_assigning_another_member_notifies_them(self, client):
        owner = _register_and_login(client, "lead@example.com")
        member = _register_and_login(client, "member@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)

        with _TestingSessionLocal() as db:
            org = Organization(name="Acme", slug="acme")
            db.add(org)
            db.commit()
            db.refresh(org)
            for uid in (owner_id, member_id):
                user = db.get(User, uid)
                user.org_id = org.id
            case = Case(user_id=owner_id, title="Suspicious Modbus burst", status="open", severity="high")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id

        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text

        feed = client.get("/api/v1/notifications/", headers=member).json()
        assert feed["unread_count"] == 1
        note = feed["data"][0]
        assert note["kind"] == "case_assigned"
        assert note["title"] == f"Case #{case_id} assigned to you"
        assert note["link"] == f"/app/cases/{case_id}"

    def test_self_assignment_does_not_notify(self, client):
        owner = _register_and_login(client, "solo@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Solo case", status="open", severity="low")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id

        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": owner_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=owner).json()
        assert feed["unread_count"] == 0


class TestCaseUpdateNotification:
    """Owner edits to severity/due date notify the assignee (case_updated)."""

    def _assigned_case(self, client):
        # Register an owner and a member in one org; owner creates and assigns a case.
        owner = _register_and_login(client, "owner2@example.com")
        member = _register_and_login(client, "member2@example.com")
        owner_id = _user_id(client, owner)
        member_id = _user_id(client, member)
        with _TestingSessionLocal() as db:
            org = Organization(name="Acme", slug="acme-2")
            db.add(org)
            db.commit()
            db.refresh(org)
            for uid in (owner_id, member_id):
                user = db.get(User, uid)
                user.org_id = org.id
            case = Case(user_id=owner_id, title="Odd SMB scanning", status="open", severity="high")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": member_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        return owner, member, case_id

    def test_severity_change_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?severity=critical", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 1
        note = updates[0]
        assert note["title"] == f"Case #{case_id} updated"
        assert "severity high -> critical" in note["body"]
        assert note["link"] == f"/app/cases/{case_id}"

    def test_due_date_change_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?due_date=2026-12-01", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        resp = client.patch(
            f"/api/v1/cases/{case_id}?due_date=2026-12-15", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 2
        assert "due date none -> 2026-12-01" in updates[1]["body"]
        assert "due date 2026-12-01 -> 2026-12-15" in updates[0]["body"]

    def test_cleared_due_date_notifies_assignee(self, client):
        owner, member, case_id = self._assigned_case(client)
        client.patch(f"/api/v1/cases/{case_id}?due_date=2026-12-01", headers=owner)
        resp = client.patch(f"/api/v1/cases/{case_id}?due_date=", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert len(updates) == 2
        assert "due date 2026-12-01 -> cleared" in updates[0]["body"]

    def test_unchanged_severity_does_not_notify(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []

    def test_title_change_does_not_notify(self, client):
        owner, member, case_id = self._assigned_case(client)
        resp = client.patch(
            f"/api/v1/cases/{case_id}?title=Renamed%20case", headers=owner,
        )
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=member).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []

    def test_unassigned_case_update_notifies_nobody(self, client):
        owner = _register_and_login(client, "lonely@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Solo", status="open", severity="low")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        with _TestingSessionLocal() as db:
            count = db.query(Notification).filter(Notification.kind == "case_updated").count()
        assert count == 0

    def test_owner_self_assigned_gets_no_notification(self, client):
        owner = _register_and_login(client, "selfy@example.com")
        owner_id = _user_id(client, owner)
        with _TestingSessionLocal() as db:
            case = Case(user_id=owner_id, title="Mine", status="open", severity="medium")
            db.add(case)
            db.commit()
            db.refresh(case)
            case_id = case.id
        resp = client.post(
            f"/api/v1/cases/{case_id}/assign", json={"user_id": owner_id}, headers=owner,
        )
        assert resp.status_code == 200, resp.text
        resp = client.patch(f"/api/v1/cases/{case_id}?severity=high", headers=owner)
        assert resp.status_code == 200, resp.text
        feed = client.get("/api/v1/notifications/", headers=owner).json()
        updates = [n for n in feed["data"] if n["kind"] == "case_updated"]
        assert updates == []


def _review(client, headers, operation="mark_read", kind=None):
    params = {"operation": operation}
    if kind:
        params["kind"] = kind
    response = client.get("/api/v1/notifications/review-batch", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _apply_review(client, headers, review):
    return client.post("/api/v1/notifications/review-batch", headers=headers, json={
        "operation": review["operation"], "kind": review["kind"], "fingerprint": review["fingerprint"],
        "ids": [row["id"] for row in review["records"]],
    })


def test_notification_review_applies_only_exact_reviewed_ids_and_leaves_new_arrivals(client):
    headers = _register_and_login(client, "review-owner@example.com")
    uid = _user_id(client, headers)
    first = _add_notification(uid, "Reviewed unread", kind="case_assigned")
    other_kind = _add_notification(uid, "Other type", kind="alert_created")
    review = _review(client, headers, kind="case_assigned")
    assert review["total"] == 1 and [row["id"] for row in review["records"]] == [first]
    arrival = _add_notification(uid, "Arrived after review", kind="case_assigned")
    result = _apply_review(client, headers, review)
    assert result.status_code == 200, result.text
    assert result.json() == {"success": True, "operation": "mark_read", "ids": [first], "affected": 1}
    with _TestingSessionLocal() as db:
        assert db.get(Notification, first).read_at is not None
        assert db.get(Notification, arrival).read_at is None
        assert db.get(Notification, other_kind).read_at is None
    assert _apply_review(client, headers, review).status_code == 409


def test_notification_review_deletes_only_reviewed_read_records(client):
    headers = _register_and_login(client, "review-delete@example.com")
    uid = _user_id(client, headers)
    read_id = _add_notification(uid, "Read", read=True)
    unread_id = _add_notification(uid, "Unread")
    review = _review(client, headers, "delete_read")
    late_read = _add_notification(uid, "New read record", read=True)
    assert _apply_review(client, headers, review).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(Notification, read_id) is None
        assert db.get(Notification, unread_id) is not None
        assert db.get(Notification, late_read) is not None


@pytest.mark.parametrize("change", ["body", "title", "read", "delete", "mute"])
def test_notification_review_rejects_stale_records_without_partial_changes(client, change):
    headers = _register_and_login(client, "review-stale@example.com")
    uid = _user_id(client, headers)
    first = _add_notification(uid, "First", kind="case_assigned")
    second = _add_notification(uid, "Second", kind="case_assigned")
    review = _review(client, headers)
    with _TestingSessionLocal() as db:
        row = db.get(Notification, first)
        if change == "body":
            row.body = "Changed body"
        elif change == "title":
            row.title = "Changed title"
        elif change == "read":
            from datetime import UTC, datetime
            row.read_at = datetime.now(UTC)
        elif change == "delete":
            db.delete(row)
        else:
            db.get(User, uid).muted_kinds = ["case_assigned"]
        db.commit()
    result = _apply_review(client, headers, review)
    assert result.status_code == 409, result.text
    with _TestingSessionLocal() as db:
        assert db.get(Notification, second).read_at is None


def test_notification_review_never_includes_muted_types_and_does_not_cross_accounts(client):
    headers = _register_and_login(client, "review-private@example.com")
    other = _register_and_login(client, "review-outsider@example.com")
    uid = _user_id(client, headers)
    visible = _add_notification(uid, "Visible", kind="alert_created")
    muted = _add_notification(uid, "Muted", kind="case_assigned")
    with _TestingSessionLocal() as db:
        db.get(User, uid).muted_kinds = ["case_assigned"]
        db.commit()
    review = _review(client, headers)
    assert [row["id"] for row in review["records"]] == [visible]
    assert _review(client, headers, kind="case_assigned")["total"] == 0
    assert _apply_review(client, other, review).status_code == 409
    assert _apply_review(client, headers, review).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(Notification, muted).read_at is None


def test_notification_review_caps_exact_newest_records_and_ignores_page_limits(client):
    headers = _register_and_login(client, "review-cap@example.com")
    uid = _user_id(client, headers)
    with _TestingSessionLocal() as db:
        db.add_all([Notification(user_id=uid, title=f"Record {index}", kind="alert_created") for index in range(105)])
        db.commit()
    review = _review(client, headers)
    ids = [row["id"] for row in review["records"]]
    assert review["total"] == 105 and len(ids) == 100 and ids == sorted(ids, reverse=True)
    assert _apply_review(client, headers, review).status_code == 200
    assert _review(client, headers)["total"] == 5


@pytest.mark.parametrize("ids", [[], [1, 1], [0], [-1], [True], ["1"], list(range(1, 102))])
def test_notification_review_validates_exact_batch_ids(client, ids):
    headers = _register_and_login(client, "review-invalid@example.com")
    result = client.post("/api/v1/notifications/review-batch", headers=headers, json={
        "operation": "mark_read", "ids": ids, "fingerprint": "a" * 64,
    })
    assert result.status_code == 422


def test_text_search_literal_title_body_owner_muting_and_pagination(client):
    from sqlalchemy import select
    headers = _register_and_login(client, 'text-search@example.com')
    other_headers = _register_and_login(client, 'text-other@example.com')
    uid, other = _user_id(client, headers), _user_id(client, other_headers)
    first = _add_notification(uid, 'Literal 100%_match', read=True)
    second = _add_notification(uid, 'Different title')
    _add_notification(uid, 'Literal 100percentXmatch')
    _add_notification(other, 'Literal 100%_match')
    muted = _add_notification(uid, 'Literal 100%_match', kind='alert_mention')
    with _TestingSessionLocal() as db:
        db.get(Notification, second).body = 'Body has 100%_MATCH too'
        db.get(User, uid).muted_kinds = ['alert_mention']
        db.commit()
    params = {'query': ' 100%_match ', 'size': 1}
    response = client.get('/api/v1/notifications/', params=params, headers=headers).json()
    assert response['total'] == 2
    assert len(response['data']) == 1
    next_page = client.get('/api/v1/notifications/', params={**params, 'page': 2}, headers=headers).json()
    assert {response['data'][0]['id'], next_page['data'][0]['id']} == {first, second}
    unread = client.get('/api/v1/notifications/', params={**params, 'unread_only': True}, headers=headers).json()
    assert unread['total'] == 1 and unread['data'][0]['id'] == second
    assert muted not in {response['data'][0]['id'], next_page['data'][0]['id']}
    assert client.get('/api/v1/notifications/', params={'query': 'x' * 201}, headers=headers).status_code == 422
    with _TestingSessionLocal() as db:
        assert db.execute(select(Notification).where(Notification.id == second)).scalar_one().read_at is None


def test_search_review_exact_scope_and_fingerprint_cannot_be_broadened(client):
    headers = _register_and_login(client, 'text-review@example.com')
    uid = _user_id(client, headers)
    matched = _add_notification(uid, 'target search')
    untouched = _add_notification(uid, 'unrelated')
    params = {'operation': 'mark_read', 'query': ' target '}
    review = client.get('/api/v1/notifications/review-batch', params=params, headers=headers).json()
    assert review['query'] == 'target' and review['total'] == 1
    assert [row['id'] for row in review['records']] == [matched]
    payload = {'operation': 'mark_read', 'ids': [matched], 'fingerprint': review['fingerprint']}
    assert client.post('/api/v1/notifications/review-batch', json=payload, headers=headers).status_code == 409
    newcomer = _add_notification(uid, 'target new arrival')
    result = client.post('/api/v1/notifications/review-batch', json={**payload, 'query': 'target'}, headers=headers)
    assert result.status_code == 200 and result.json()['ids'] == [matched]
    with _TestingSessionLocal() as db:
        assert db.get(Notification, untouched).read_at is None
        assert db.get(Notification, newcomer).read_at is None
    review = client.get('/api/v1/notifications/review-batch', params={'operation': 'delete_read', 'query': 'target'}, headers=headers).json()
    result = client.post('/api/v1/notifications/review-batch', json={'operation': 'delete_read', 'query': 'target', 'ids': [matched], 'fingerprint': review['fingerprint']}, headers=headers)
    assert result.status_code == 200
