"""
Tests for manual investigation creation (POST /api/v1/cases/).
"""

from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_case_create.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_case_create.db"
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


@pytest.fixture(scope="function")
def client():
    """Create a test client with fresh database tables."""
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_async_db] = _override_get_async_db

    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=_engine)


def register_and_login(client: TestClient, email: str, password: str = "securepass123"):
    """Register a user and return auth headers."""
    reg = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": password,
        "full_name": f"User {email.split('@')[0]}",
        "company": "TestCorp",
    })
    assert reg.status_code == 201, f"Registration failed: {reg.text}"
    login = client.post("/api/v1/auth/login", data={
        "username": email,
        "password": password,
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestManualCaseCreation:
    """Tests for POST /api/v1/cases/"""

    def test_create_case(self, client):
        """A manually opened case is attributed to a human and starts open."""
        headers = register_and_login(client, "analyst@example.com")
        resp = client.post("/api/v1/cases/", json={
            "title": "Suspicious USB activity on floor 3",
            "summary": "Multiple hosts reported new removable media.",
            "severity": "high",
        }, headers=headers)

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "Suspicious USB activity on floor 3"
        assert data["summary"] == "Multiple hosts reported new removable media."
        assert data["severity"] == "high"
        assert data["status"] == "open"
        assert data["created_by"] == "human"
        assert data["alert_count"] == 0
        assert data["event_count"] == 0

        listing = client.get("/api/v1/cases/", headers=headers)
        assert listing.status_code == 200
        assert listing.json()["total"] == 1
        assert listing.json()["cases"][0]["title"] == "Suspicious USB activity on floor 3"

    def test_create_case_records_a_timeline_note(self, client):
        """Opening a case manually leaves an attribution note on its timeline."""
        headers = register_and_login(client, "analyst@example.com")
        created = client.post("/api/v1/cases/", json={
            "title": "Odd VPN logins",
        }, headers=headers)
        assert created.status_code == 201, created.text
        case_id = created.json()["id"]

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.status_code == 200, detail.text
        notes = [e for e in detail.json()["timeline"] if e["entry_type"] == "note"]
        assert any("analyst@example.com" in e["content"] for e in notes)

    def test_create_case_defaults(self, client):
        """Severity defaults to medium and a blank summary is stored as null."""
        headers = register_and_login(client, "analyst@example.com")
        resp = client.post("/api/v1/cases/", json={
            "title": "  Padded title  ",
            "summary": "   ",
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "Padded title"
        assert data["summary"] is None
        assert data["severity"] == "medium"

    def test_create_case_rejects_invalid_input(self, client):
        """Blank titles, bad severities and unknown fields are rejected."""
        headers = register_and_login(client, "analyst@example.com")
        for payload in (
            {"title": "   "},
            {"title": "Ok title", "severity": "severe"},
            {"title": "Ok title", "assignee": "bob"},
            {},
        ):
            resp = client.post("/api/v1/cases/", json=payload, headers=headers)
            assert resp.status_code == 422, (payload, resp.text)

    def test_create_case_requires_auth(self, client):
        resp = client.post("/api/v1/cases/", json={"title": "Nope"})
        assert resp.status_code == 401


class TestCaseNotes:
    """Tests for POST /api/v1/cases/{case_id}/notes"""

    def _make_case(self, client, headers, title="Case for notes") -> int:
        resp = client.post("/api/v1/cases/", json={"title": title}, headers=headers)
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_add_note(self, client):
        """A note lands on the case timeline attributed to a human."""
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)

        resp = client.post(f"/api/v1/cases/{case_id}/notes", json={
            "content": "  Called the on-call admin; host reimaged.  ",
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["entry_type"] == "note"
        assert data["source"] == "human"
        assert data["content"] == "Called the on-call admin; host reimaged."
        assert data["timestamp"]

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        notes = [e for e in detail.json()["timeline"] if e["entry_type"] == "note"]
        assert any("host reimaged" in e["content"] for e in notes)

    def test_note_on_missing_or_foreign_case_is_404(self, client):
        owner = register_and_login(client, "owner@example.com")
        outsider = register_and_login(client, "outsider@example.com")
        case_id = self._make_case(client, owner)

        foreign = client.post(f"/api/v1/cases/{case_id}/notes", json={"content": "hi"}, headers=outsider)
        missing = client.post("/api/v1/cases/99999/notes", json={"content": "hi"}, headers=owner)
        assert foreign.status_code == 404
        assert missing.status_code == 404

    def test_blank_note_rejected(self, client):
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)
        resp = client.post(f"/api/v1/cases/{case_id}/notes", json={"content": "   "}, headers=headers)
        assert resp.status_code == 422, resp.text


class TestCaseAlertLinking:
    """Tests for POST /api/v1/cases/{case_id}/alerts/{alert_id}"""

    def _make_alert(self, client: TestClient, headers, title="Suspicious login burst") -> int:
        from backend.models.alert import Alert

        asset = client.post("/api/v1/assets/", json={
            "name": "Edge router", "asset_type": "hardware", "vendor": "Cisco",
            "product": "ASR1000", "version": "1.0", "description": "Test asset",
        }, headers=headers)
        assert asset.status_code == 201, asset.text
        me = client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200, me.text
        db = _TestingSessionLocal()
        try:
            alert = Alert(
                user_id=me.json()["id"], asset_id=asset.json()["id"],
                title=title, severity="high", status="pending",
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            return alert.id
        finally:
            db.close()

    def _make_case(self, client: TestClient, headers) -> int:
        resp = client.post("/api/v1/cases/", json={"title": "Link target"}, headers=headers)
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_link_alert(self, client):
        """Linking an alert adds it to the case and notes it on the timeline."""
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)
        alert_id = self._make_alert(client, headers)

        resp = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["linked"] is True

        alerts = client.get(f"/api/v1/cases/{case_id}/alerts", headers=headers)
        assert [a["id"] for a in alerts.json()] == [alert_id]

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["alert_count"] == 1
        link_entries = [e for e in detail.json()["timeline"] if e["entry_type"] == "alert"]
        assert any("Suspicious login burst" in e["content"] for e in link_entries)

    def test_link_is_idempotent(self, client):
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)
        alert_id = self._make_alert(client, headers)

        client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        again = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert again.status_code == 200, again.text
        assert again.json()["data"]["linked"] is False
        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["alert_count"] == 1

    def test_link_higher_severity_alert_raises_case_severity(self, client):
        # Linking an alert more severe than the case raises the case severity.
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)  # defaults to medium
        alert_id = self._make_alert(client, headers)  # high

        resp = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert resp.status_code == 200, resp.text

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["severity"] == "high"
        raise_entries = [
            e for e in detail.json()["timeline"]
            if e["entry_type"] == "action" and "Severity raised to high" in e["content"]
        ]
        assert raise_entries

    def test_link_lower_severity_alert_keeps_case_severity(self, client):
        # A less severe alert never lowers the case severity.
        headers = register_and_login(client, "analyst@example.com")
        resp = client.post(
            "/api/v1/cases/", json={"title": "Critical case", "severity": "critical"}, headers=headers
        )
        assert resp.status_code == 201, resp.text
        case_id = resp.json()["id"]
        alert_id = self._make_alert(client, headers)  # high

        resp = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert resp.status_code == 200, resp.text

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["severity"] == "critical"
        assert not [
            e for e in detail.json()["timeline"]
            if e["entry_type"] == "action" and "Severity raised" in e["content"]
        ]

    def test_foreign_case_or_alert_is_404(self, client):
        owner = register_and_login(client, "owner@example.com")
        outsider = register_and_login(client, "outsider@example.com")
        case_id = self._make_case(client, owner)
        alert_id = self._make_alert(client, owner)

        foreign_case = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=outsider)
        foreign_alert = client.post(f"/api/v1/cases/{case_id}/alerts/99999", headers=owner)
        assert foreign_case.status_code == 404
        assert foreign_alert.status_code == 404


class TestCaseEventLinking:
    """Tests for POST /api/v1/cases/{case_id}/events/{event_id}"""

    def _make_event(self, client: TestClient, headers, signature="ET SCAN Nmap") -> int:
        from datetime import datetime

        from backend.models.security_event import SecurityEvent

        me = client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200, me.text
        db = _TestingSessionLocal()
        try:
            event = SecurityEvent(
                user_id=me.json()["id"],
                timestamp=datetime.now(UTC),
                event_type="alert", severity="high", signature=signature,
                source_ip="10.0.4.9", dest_ip="10.0.4.20",
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            return event.id
        finally:
            db.close()

    def _make_case(self, client: TestClient, headers) -> int:
        resp = client.post("/api/v1/cases/", json={"title": "Event link target"}, headers=headers)
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_link_event(self, client):
        """Linking an event adds it to the case, marks it in_case and notes the timeline."""
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)
        event_id = self._make_event(client, headers)

        resp = client.post(f"/api/v1/cases/{case_id}/events/{event_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["linked"] is True

        events = client.get(f"/api/v1/cases/{case_id}/events", headers=headers)
        assert [e["id"] for e in events.json()] == [event_id]

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["event_count"] == 1
        link_entries = [e for e in detail.json()["timeline"] if e["entry_type"] == "event"]
        assert any("ET SCAN Nmap" in e["content"] for e in link_entries)

        db = _TestingSessionLocal()
        try:
            from backend.models.security_event import SecurityEvent
            stored = db.get(SecurityEvent, event_id)
            assert stored.processed == "in_case"
        finally:
            db.close()

    def test_link_is_idempotent(self, client):
        headers = register_and_login(client, "analyst@example.com")
        case_id = self._make_case(client, headers)
        event_id = self._make_event(client, headers)

        client.post(f"/api/v1/cases/{case_id}/events/{event_id}", headers=headers)
        again = client.post(f"/api/v1/cases/{case_id}/events/{event_id}", headers=headers)
        assert again.status_code == 200, again.text
        assert again.json()["data"]["linked"] is False
        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["event_count"] == 1

    def test_foreign_case_or_event_is_404(self, client):
        owner = register_and_login(client, "owner@example.com")
        outsider = register_and_login(client, "outsider@example.com")
        case_id = self._make_case(client, owner)
        event_id = self._make_event(client, owner)

        foreign_case = client.post(f"/api/v1/cases/{case_id}/events/{event_id}", headers=outsider)
        foreign_event = client.post(f"/api/v1/cases/{case_id}/events/99999", headers=owner)
        assert foreign_case.status_code == 404
        assert foreign_event.status_code == 404


class TestCaseUnlinking:
    """Tests for DELETE /api/v1/cases/{case_id}/alerts|events/{id}"""

    def _setup_linked(self, client: TestClient, headers):
        link = TestCaseAlertLinking()
        case_id = link._make_case(client, headers)
        alert_id = link._make_alert(client, headers)
        resp = client.post(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        ev = TestCaseEventLinking()
        event_id = ev._make_event(client, headers)
        resp = client.post(f"/api/v1/cases/{case_id}/events/{event_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        return case_id, alert_id, event_id

    def test_unlink_alert(self, client):
        """Unlinking an alert removes the link and notes the timeline."""
        headers = register_and_login(client, "analyst@example.com")
        case_id, alert_id, _ = self._setup_linked(client, headers)

        resp = client.delete(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["unlinked"] is True

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["alert_count"] == 0
        assert client.get(f"/api/v1/cases/{case_id}/alerts", headers=headers).json() == []
        unlink_notes = [e for e in detail.json()["timeline"] if "unlinked" in e["content"]]
        assert len(unlink_notes) == 1

    def test_unlink_alert_is_idempotent(self, client):
        headers = register_and_login(client, "analyst@example.com")
        case_id, alert_id, _ = self._setup_linked(client, headers)

        client.delete(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        again = client.delete(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=headers)
        assert again.status_code == 200, again.text
        assert again.json()["data"]["unlinked"] is False

    def test_unlink_event(self, client):
        """Unlinking an event removes the link and notes the timeline."""
        headers = register_and_login(client, "analyst@example.com")
        case_id, _, event_id = self._setup_linked(client, headers)

        resp = client.delete(f"/api/v1/cases/{case_id}/events/{event_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["unlinked"] is True

        detail = client.get(f"/api/v1/cases/{case_id}", headers=headers)
        assert detail.json()["event_count"] == 0
        assert client.get(f"/api/v1/cases/{case_id}/events", headers=headers).json() == []

    def test_unlink_requires_owned_case(self, client):
        owner = register_and_login(client, "owner@example.com")
        outsider = register_and_login(client, "outsider@example.com")
        case_id, alert_id, event_id = self._setup_linked(client, owner)

        assert client.delete(f"/api/v1/cases/{case_id}/alerts/{alert_id}", headers=outsider).status_code == 404
        assert client.delete(f"/api/v1/cases/{case_id}/events/{event_id}", headers=outsider).status_code == 404
        # Owner's links are untouched.
        detail = client.get(f"/api/v1/cases/{case_id}", headers=owner)
        assert detail.json()["alert_count"] == 1
        assert detail.json()["event_count"] == 1
