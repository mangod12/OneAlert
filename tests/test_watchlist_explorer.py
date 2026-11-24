"""Complete watchlist search is bounded, literal, stable and watcher-scoped."""
from datetime import UTC, datetime, timedelta

import pytest

from backend.models.alert import Alert, AlertWatcher
from backend.models.asset import Asset
from backend.models.case import Case, CaseWatcher
from tests.test_case_watchers import (
    _seed_watchlist_actor,
    _TestingSessionLocal,
    _user_id,
)
from tests.test_case_watchers import client as client

URL = "/api/v1/cases/watched-record-explorer"


def seed(client):
    owner = _seed_watchlist_actor(client, "owner@example.com")
    follower = _seed_watchlist_actor(client, "follower@example.com")
    stranger = _seed_watchlist_actor(client, "stranger@example.com")
    uid, fid, sid = (_user_id(client, h) for h in (owner, follower, stranger))
    today = datetime.now(UTC).date()
    when = datetime(2026, 1, 1, tzinfo=UTC)
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=uid, name="Plant_Gateway%literal", asset_type="hardware")
        db.add(asset)
        db.flush()
        for i in range(135):
            status = "closed" if i == 1 else "open"
            common = {"user_id": uid, "title": f"Record {i:03}", "severity": "critical" if i == 134 else "high",
                      "status": status, "created_at": when + timedelta(minutes=i),
                      "due_date": today - timedelta(days=1) if i in (1, 134) else None}
            alert = Alert(**common, asset_id=asset.id, cve_id="CVE-2099-0134" if i == 134 else None)
            case = Case(**common)
            db.add_all([alert, case])
            db.flush()
            # Final two pairs are owned but not followed, or followed by someone else.
            if i < 133:
                db.add_all([AlertWatcher(alert_id=alert.id, user_id=fid), CaseWatcher(case_id=case.id, user_id=fid)])
            elif i == 133:
                db.add_all([AlertWatcher(alert_id=alert.id, user_id=sid), CaseWatcher(case_id=case.id, user_id=sid)])
            else:
                db.add_all([AlertWatcher(alert_id=alert.id, user_id=fid), CaseWatcher(case_id=case.id, user_id=fid)])
        # Owned by the follower but deliberately not followed.
        db.add(Case(user_id=fid, title="Private unfollowed", status="open", severity="critical"))
        db.commit()
    return owner, follower, stranger, today


def fetch(client, headers, **params):
    response = client.get(URL, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_complete_combined_search_and_no_owner_or_other_watch_leaks(client):
    owner, follower, stranger, _ = seed(client)
    result = fetch(client, follower)
    assert result["total"] == 268 and len(result["data"]) == 25
    assert result["data"][0]["title"] == "Record 134"
    assert {row["kind"] for row in result["data"][:2]} == {"alert", "case"}
    assert fetch(client, owner)["total"] == 0
    assert fetch(client, stranger)["total"] == 2
    assert fetch(client, follower, query="Private unfollowed")["total"] == 0
    assert fetch(client, follower, query="Record 133")["total"] == 0
    assert fetch(client, follower, query="CVE-2099-0134")["total"] == 1
    assert fetch(client, follower, query="record 134")["total"] == 2


def test_literal_search_asset_name_record_id_and_empty_trim(client):
    _, follower, _, _ = seed(client)
    assert fetch(client, follower, query="  PLANT_Gateway%literal  ")["total"] == 134
    assert fetch(client, follower, query="%literal")["total"] == 134
    assert fetch(client, follower, query="%notpresent")["total"] == 0
    assert fetch(client, follower, query="_notpresent")["total"] == 0
    assert fetch(client, follower, query="' OR 1=1 --")["total"] == 0
    assert fetch(client, follower, query=" ")["total"] == 268
    assert any(row["id"] == 135 for row in fetch(client, follower, query="135")["data"])


def test_filter_scopes_cover_alert_due_dates_and_completed_investigations(client):
    _, follower, _, today = seed(client)
    assert fetch(client, follower, kind="alert")["total"] == 134
    assert fetch(client, follower, kind="case")["total"] == 134
    assert fetch(client, follower, scope="done")["total"] == 2
    assert fetch(client, follower, scope="active")["total"] == 266
    overdue = fetch(client, follower, scope="overdue")
    assert overdue["total"] == 2 and overdue["date_basis"] == today.isoformat()
    assert {row["kind"] for row in overdue["data"]} == {"alert", "case"}
    assert all(row["due_date"] < today.isoformat() for row in overdue["data"])
    assert fetch(client, follower, severity="critical")["total"] == 2
    assert fetch(client, follower, kind="case", scope="done", severity="critical")["total"] == 0


@pytest.mark.parametrize("sort,first,last", [("newest", "Record 134", "Record 000"),
                                              ("oldest", "Record 000", "Record 134"),
                                              ("name", "Record 000", "Record 134"),
                                              ("due", "Record 134", None)])
def test_global_order_and_stable_pagination_without_duplicates(client, sort, first, last):
    _, follower, _, _ = seed(client)
    rows = []
    for page in range(1, 4):
        result = fetch(client, follower, size=100, page=page, sort=sort)
        assert result["total"] == 268
        rows.extend(result["data"])
    assert len(rows) == len({(row["kind"], row["id"]) for row in rows}) == 268
    assert rows[0]["title"] == first
    if last:
        assert rows[-1]["title"] == last
    assert fetch(client, follower, page=40)["data"] == []


def test_unwatch_removes_current_search_evidence_without_touching_record(client):
    _, follower, _, _ = seed(client)
    result = fetch(client, follower, query="Record 134")
    alert = next(row for row in result["data"] if row["kind"] == "alert")
    response = client.delete(f"/api/v1/alerts/{alert['id']}/watch", headers=follower)
    assert response.status_code == 200
    result = fetch(client, follower, query="Record 134")
    assert result["total"] == 1 and result["data"][0]["kind"] == "case"
    with _TestingSessionLocal() as db:
        assert db.get(Alert, alert["id"]) is not None


@pytest.mark.parametrize("params", [{"page": 0}, {"size": 101}, {"size": 0}, {"query": "a" * 201},
                                     {"kind": "users"}, {"scope": "everything"}, {"severity": "unknown"},
                                     {"sort": "id; DROP"}])
def test_validation_and_auth(client, params):
    headers = _seed_watchlist_actor(client, "reader@example.com")
    assert client.get(URL, params=params, headers=headers).status_code == 422
    client.cookies.clear()
    assert client.get(URL).status_code in (401, 403)
