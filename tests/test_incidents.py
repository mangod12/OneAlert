"""Tests for incident correlation."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.network_connection import NetworkConnection

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_incidents.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_incidents.db"
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


def _seed(user_id: int):
    """Two assets: plc-01 with 3 active alerts + 1 resolved, lonely with 1 alert."""
    with _TestingSessionLocal() as db:
        plc = Asset(user_id=user_id, name="plc-01", asset_type="hardware",
                    vendor="Acme", product="PLC-300", last_known_ip="10.0.0.5",
                    criticality="critical")
        lonely = Asset(user_id=user_id, name="printer-01", asset_type="hardware")
        db.add_all([plc, lonely])
        db.flush()
        for title, severity, status, cve in [
            ("Modbus coil write", "critical", "pending", "CVE-2026-1001"),
            ("Firmware backdoor", "high", "acknowledged", "CVE-2026-1002"),
            ("Default credentials", "high", "pending", "CVE-2026-1001"),
            ("Old issue", "low", "resolved", "CVE-2025-9999"),
        ]:
            db.add(Alert(user_id=user_id, asset_id=plc.id, cve_id=cve,
                         title=title, severity=severity, status=status))
        db.add(Alert(user_id=user_id, asset_id=lonely.id, cve_id="CVE-2026-2000",
                     title="Lonely alert", severity="low", status="pending"))
        db.add(NetworkConnection(user_id=user_id, source_ip="10.0.0.5",
                                 target_ip="10.0.0.9", protocol="modbus"))
        db.add(NetworkConnection(user_id=user_id, source_ip="10.0.0.2",
                                 target_ip="10.0.0.5", protocol="ssh"))
        db.commit()
        return plc.id


class TestIncidentList:
    def test_groups_alerts_by_asset(self, client):
        headers = _register_and_login(client, "inc@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)

        resp = client.get("/api/v1/incidents", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1  # lonely asset (1 alert) is not an incident
        inc = body["incidents"][0]
        assert inc["asset_id"] == asset_id
        assert inc["asset_name"] == "plc-01"
        assert inc["alert_count"] == 3  # resolved alert excluded
        assert inc["max_severity"] == "critical"
        assert inc["shared_cves"] == ["CVE-2026-1001", "CVE-2026-1002"]
        assert inc["blast_radius"] == 2
        assert inc["alerts"][0]["severity"] == "critical"

    def test_empty_when_no_correlation(self, client):
        headers = _register_and_login(client, "empty@example.com")
        resp = client.get("/api/v1/incidents", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"total": 0, "incidents": []}

    def test_linked_cases_included(self, client):
        headers = _register_and_login(client, "cases@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)
        with _TestingSessionLocal() as db:
            alert_id = db.query(Alert).filter(Alert.asset_id == asset_id).first().id
            case = Case(user_id=uid, title="PLC compromise", status="open", severity="critical")
            db.add(case)
            db.flush()
            db.add(CaseAlert(case_id=case.id, alert_id=alert_id))
            db.commit()
            case_id = case.id

        resp = client.get("/api/v1/incidents", headers=headers)
        cases = resp.json()["incidents"][0]["linked_cases"]
        assert cases == [{"id": case_id, "title": "PLC compromise", "status": "open"}]

    def test_scoped_per_user(self, client):
        headers = _register_and_login(client, "owner2@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        _seed(uid)
        other = _register_and_login(client, "other2@example.com")
        resp = client.get("/api/v1/incidents", headers=other)
        assert resp.json() == {"total": 0, "incidents": []}


class TestIncidentTimeline:
    def test_timeline_includes_creation_and_changes(self, client):
        headers = _register_and_login(client, "tl@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)
        with _TestingSessionLocal() as db:
            alert_id = db.query(Alert).filter(
                Alert.asset_id == asset_id, Alert.status == "pending"
            ).first().id
        resp = client.patch(
            f"/api/v1/alerts/{alert_id}", json={"status": "acknowledged"}, headers=headers,
        )
        assert resp.status_code == 200, resp.text

        resp = client.get(f"/api/v1/incidents/{asset_id}/timeline", headers=headers)
        assert resp.status_code == 200, resp.text
        events = resp.json()["events"]
        kinds = {e["kind"] for e in events}
        assert "alert_created" in kinds
        assert "alert_updated" in kinds
        updated = [e for e in events if e["kind"] == "alert_updated"]
        assert updated[0]["alert_id"] == alert_id
        timestamps = [e["timestamp"] for e in events if e["timestamp"]]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_timeline_404_for_other_users_asset(self, client):
        headers = _register_and_login(client, "owner3@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)
        other = _register_and_login(client, "other3@example.com")
        resp = client.get(f"/api/v1/incidents/{asset_id}/timeline", headers=other)
        assert resp.status_code == 404


class TestIncidentEscalation:
    def test_escalate_creates_case_with_linked_alerts(self, client):
        headers = _register_and_login(client, "esc@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)

        resp = client.post(f"/api/v1/incidents/{asset_id}/escalate", headers=headers)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["title"] == "Incident on plc-01"
        assert body["severity"] == "critical"
        assert body["alerts_linked"] == 3

        with _TestingSessionLocal() as db:
            from backend.models.audit_log import AuditLog
            links = db.query(CaseAlert).filter(CaseAlert.case_id == body["id"]).all()
            assert len(links) == 3
            rows = db.query(AuditLog).filter(AuditLog.action == "incident_escalated").all()
            assert any(r.target_type == "case" and r.target_id == body["id"] for r in rows)

    def test_escalate_404_for_other_users_asset(self, client):
        headers = _register_and_login(client, "escowner@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        asset_id = _seed(uid)
        other = _register_and_login(client, "escother@example.com")
        assert client.post(f"/api/v1/incidents/{asset_id}/escalate", headers=other).status_code == 404

    def test_escalate_400_without_active_alerts(self, client):
        headers = _register_and_login(client, "escempty@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        with _TestingSessionLocal() as db:
            asset = Asset(user_id=uid, name="quiet-01", asset_type="hardware")
            db.add(asset)
            db.commit()
            asset_id = asset.id
        assert client.post(
            f"/api/v1/incidents/{asset_id}/escalate", headers=headers,
        ).status_code == 400


def _seed_two_incidents(user_id: int):
    """plc-01 with a critical incident, hmi-02 with a medium incident."""
    with _TestingSessionLocal() as db:
        plc = Asset(user_id=user_id, name="plc-01", asset_type="hardware",
                    vendor="Acme", product="PLC-300", criticality="critical")
        hmi = Asset(user_id=user_id, name="hmi-02", asset_type="hardware",
                    vendor="Contoso", product="HMI-9", criticality="medium")
        db.add_all([plc, hmi])
        db.flush()
        for title, severity in [("Modbus coil write", "critical"), ("Firmware backdoor", "high")]:
            db.add(Alert(user_id=user_id, asset_id=plc.id, cve_id="CVE-2026-1001",
                         title=title, severity=severity, status="pending"))
        for title, severity in [("Weak password policy", "medium"), ("Open telnet", "medium")]:
            db.add(Alert(user_id=user_id, asset_id=hmi.id, cve_id="CVE-2026-2001",
                         title=title, severity=severity, status="pending"))
        db.commit()


class TestIncidentFilters:
    def test_severity_filter_is_a_minimum(self, client):
        headers = _register_and_login(client, "incf@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        _seed_two_incidents(uid)

        all_resp = client.get("/api/v1/incidents", headers=headers).json()
        assert all_resp["total"] == 2

        high_resp = client.get("/api/v1/incidents", params={"severity": "high"}, headers=headers).json()
        assert high_resp["total"] == 1
        assert high_resp["incidents"][0]["asset_name"] == "plc-01"

        low_resp = client.get("/api/v1/incidents", params={"severity": "low"}, headers=headers).json()
        assert low_resp["total"] == 2

    def test_asset_filter_matches_name_vendor_and_product(self, client):
        headers = _register_and_login(client, "inca@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        _seed_two_incidents(uid)

        by_name = client.get("/api/v1/incidents", params={"asset": "hmi"}, headers=headers).json()
        assert by_name["total"] == 1
        assert by_name["incidents"][0]["asset_name"] == "hmi-02"

        by_vendor = client.get("/api/v1/incidents", params={"asset": "ACME"}, headers=headers).json()
        assert by_vendor["total"] == 1
        assert by_vendor["incidents"][0]["asset_name"] == "plc-01"

        by_product = client.get("/api/v1/incidents", params={"asset": "hmi-9"}, headers=headers).json()
        assert by_product["total"] == 1

        no_match = client.get("/api/v1/incidents", params={"asset": "nonexistent"}, headers=headers).json()
        assert no_match["total"] == 0

    def test_unknown_severity_rejected(self, client):
        headers = _register_and_login(client, "incx@example.com")
        resp = client.get("/api/v1/incidents", params={"severity": "catastrophic"}, headers=headers)
        assert resp.status_code == 422

    def test_filters_combine(self, client):
        headers = _register_and_login(client, "incc@example.com")
        uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
        _seed_two_incidents(uid)
        resp = client.get("/api/v1/incidents", params={"severity": "high", "asset": "hmi"}, headers=headers).json()
        assert resp["total"] == 0  # the hmi incident is only medium
