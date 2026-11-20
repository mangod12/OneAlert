"""Current incident evidence must match the reviewed proposal before creation."""
# ruff: noqa: F811
import pytest
from test_incidents import (  # noqa: F401
    _register_and_login,
    _seed,
    _TestingSessionLocal,
    client,
)

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.user import User


def setup_incident(client):
    headers = _register_and_login(client, "review@example.com")
    uid = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    aid = _seed(uid)
    response = client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=headers)
    assert response.status_code == 200, response.text
    return headers, uid, aid, response.json()


def test_preview_is_read_only_owner_scoped_stable_and_excludes_resolved(client):
    headers, _uid, aid, value = setup_incident(client)
    assert len(value["alerts"]) == 3 and all(row["status"] != "resolved" for row in value["alerts"])
    assert value["alerts"] == sorted(value["alerts"], key=lambda row: row["id"])
    assert value["title"] == "Incident on plc-01" and value["severity"] == "critical"
    assert value["status"] == "open" and value["due_date"] is None and value["existing_cases"] == []
    assert client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=headers).json() == value
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == 0 and db.query(CaseAlert).count() == 0


def test_reviewed_create_acknowledges_exact_evidence_and_cannot_replay(client):
    headers, _uid, aid, value = setup_incident(client)
    body = {"reviewed_fingerprint": value["reviewed_fingerprint"]}
    url = f"/api/v1/incidents/{aid}/escalate"
    response = client.post(url, headers=headers, json=body)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["asset_id"] == aid and saved["reviewed_fingerprint"] == body["reviewed_fingerprint"]
    assert saved["alert_ids"] == [row["id"] for row in value["alerts"]]
    assert saved["alerts_linked"] == 3
    with _TestingSessionLocal() as db:
        case = db.get(Case, saved["id"])
        assert case.summary == value["summary"] and case.title == value["title"]
        assert db.query(CaseAlert).filter_by(case_id=saved["id"]).count() == 3
        statuses = [row.status for row in db.query(Alert).filter(Alert.id.in_(saved["alert_ids"])).all()]
        assert statuses.count("pending") == 2
    assert client.post(url, headers=headers, json=body).status_code == 409
    refreshed = client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=headers).json()
    assert refreshed["existing_cases"] == [{"id": saved["id"], "title": value["title"], "status": "open"}]
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == 1


@pytest.mark.parametrize("change", [
    "title", "severity", "status", "new_alert", "deleted_alert", "asset_name", "sla", "existing_case",
])
def test_changed_evidence_or_proposal_is_rejected_without_creating_case(client, change):
    headers, uid, aid, value = setup_incident(client)
    with _TestingSessionLocal() as db:
        alert = db.get(Alert, value["alerts"][0]["id"])
        if change in {"title", "severity", "status"}:
            setattr(alert, change, {"title": "Changed detection", "severity": "low", "status": "resolved"}[change])
        elif change == "deleted_alert":
            db.delete(alert)
        elif change == "new_alert":
            db.add(Alert(user_id=uid, asset_id=aid, title="New active evidence", severity="low", status="pending"))
        elif change == "asset_name":
            db.get(Asset, aid).name = "Renamed asset"
        elif change == "sla":
            user = db.get(User, uid)
            user.sla_due_dates_enabled = True
            user.sla_days_critical = 2
        else:
            case = Case(user_id=uid, title="Already being investigated", severity="high", status="open")
            db.add(case)
            db.flush()
            db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
        db.commit()
        before = db.query(Case).count()
    response = client.post(f"/api/v1/incidents/{aid}/escalate", headers=headers,
                           json={"reviewed_fingerprint": value["reviewed_fingerprint"]})
    assert response.status_code == 409, response.text
    with _TestingSessionLocal() as db:
        assert db.query(Case).count() == before


def test_foreign_evidence_and_cases_never_enter_the_preview(client):
    headers, _uid, aid, value = setup_incident(client)
    other = _register_and_login(client, "foreign@example.com")
    other_uid = client.get("/api/v1/auth/me", headers=other).json()["id"]
    with _TestingSessionLocal() as db:
        db.add(Alert(user_id=other_uid, asset_id=aid, title="Foreign data", severity="critical", status="pending"))
        case = Case(user_id=other_uid, title="Private other case", severity="high", status="open")
        db.add(case)
        db.flush()
        db.add(CaseAlert(case_id=case.id, alert_id=value["alerts"][0]["id"]))
        db.commit()
    same = client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=headers).json()
    assert same == value
    assert client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=other).status_code == 404
    assert client.post(f"/api/v1/incidents/{aid}/escalate", headers=other,
                       json={"reviewed_fingerprint": value["reviewed_fingerprint"]}).status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/v1/incidents/{aid}/escalation-preview").status_code == 401


@pytest.mark.parametrize("body", [{}, {"reviewed_fingerprint": "bad"}, {"reviewed_fingerprint": "g" * 64},
                                  {"reviewed_fingerprint": "0" * 64, "alert_ids": [1]}])
def test_review_payload_is_strict(client, body):
    headers, _uid, aid, _value = setup_incident(client)
    assert client.post(f"/api/v1/incidents/{aid}/escalate", headers=headers, json=body).status_code == 422


def test_saved_sla_date_is_the_exact_reviewed_proposal_date(client, monkeypatch):
    """Do not recompute a different SLA target after the fingerprint check."""
    from datetime import date

    from backend.routers import incidents

    headers, _uid, aid, _value = setup_incident(client)
    dates = [date(2030, 1, 1), date(2030, 1, 1), date(2030, 1, 2)]
    monkeypatch.setattr(incidents, "sla_due_date", lambda *_args: dates.pop(0))
    value = client.get(f"/api/v1/incidents/{aid}/escalation-preview", headers=headers).json()
    response = client.post(f"/api/v1/incidents/{aid}/escalate", headers=headers,
                           json={"reviewed_fingerprint": value["reviewed_fingerprint"]})
    assert response.status_code == 201, response.text
    with _TestingSessionLocal() as db:
        assert db.get(Case, response.json()["id"]).due_date == date(2030, 1, 1)
    assert dates == [date(2030, 1, 2)]
