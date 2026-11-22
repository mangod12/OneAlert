"""Owned exact-label query scope stays identical in list, export and saved views."""

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.security_event import EventSource, SecurityEvent
from backend.routers.auth import get_current_user

FIELDS = ("username", "hostname", "domain", "action")
CLOCK = datetime(2026, 1, 1, tzinfo=UTC)


def seed(ledger, values):
    _, owner, _, _, sessions = ledger
    with sessions() as db:
        rows = [
            SecurityEvent(
                user_id=item.pop("owner", owner.id),
                timestamp=item.pop("timestamp", CLOCK),
                event_type="recorded",
                **item,
            )
            for item in values
        ]
        db.add_all(rows)
        db.commit()
        return [row.id for row in rows]


@pytest.mark.parametrize("field", FIELDS)
def test_exact_text_preserves_case_spaces_percent_underscore_and_field_boundaries_in_list_and_export(ledger, field):
    client = ledger[0]
    text = " Actor_%@Example.test "
    other_field = next(value for value in FIELDS if value != field)
    ids = seed(
        ledger,
        [
            {field: text, "source_type": "okta_system"},
            {field: text, "source_type": "github_audit"},
            {field: text.strip()},
            {field: text.lower()},
            {field: " Actor_1@Example.test "},
            {other_field: text},
            {field: None},
        ],
    )
    params = {"recorded_field": field, "recorded_value": text, "size": 1}
    first = client.get("/api/v1/events/", params=params)
    assert first.status_code == 200, first.text
    assert first.json()["total"] == 2 and [row["id"] for row in first.json()["events"]] == [ids[1]]
    second = client.get("/api/v1/events/", params={**params, "page": 2}).json()
    assert second["total"] == 2 and [row["id"] for row in second["events"]] == [ids[0]]
    csv_response = client.get(
        "/api/v1/events/export", params={key: value for key, value in params.items() if key != "size"}
    )
    assert csv_response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(csv_response.text)))
    assert [int(row["id"]) for row in rows] == [ids[1], ids[0]]
    assert all(row[field] == text for row in rows)
    assert {row["source_type"] for row in rows} == {"okta_system", "github_audit"}
    assert all("raw_data" not in row for row in rows)


def test_combines_exact_field_with_time_source_severity_type_and_existing_search_without_broadening(ledger):
    client, owner, _, _, sessions = ledger
    with sessions() as db:
        source = EventSource(user_id=owner.id, name="selected", source_type="okta_system")
        db.add(source)
        db.commit()
        source_id = source.id
    common = {
        "username": "actor",
        "severity": "high",
        "source_type": "okta_system",
        "source_id": source_id,
        "signature": "recorded label",
        "source_ip": "192.0.2.10",
    }
    selected = seed(
        ledger,
        [
            {**common, "timestamp": CLOCK},
            {**common, "timestamp": CLOCK + timedelta(hours=1)},
            {**common, "source_id": None},
            {**common, "severity": "info"},
            {**common, "username": "other"},
        ],
    )[0]
    params = {
        "recorded_field": "username",
        "recorded_value": "actor",
        "source_id": source_id,
        "source_type": "okta_system",
        "severity": "high",
        "event_type": "recorded",
        "signature": "label",
        "ip": "192.0.2",
        "started_at": CLOCK.isoformat(),
        "ended_before": (CLOCK + timedelta(hours=1)).isoformat(),
    }
    data = client.get("/api/v1/events/", params=params).json()
    assert data["total"] == 1 and data["events"][0]["id"] == selected
    rows = list(csv.DictReader(io.StringIO(client.get("/api/v1/events/export", params=params).text)))
    assert [int(row["id"]) for row in rows] == [selected] and rows[0]["source_id"] == str(source_id)


@pytest.mark.parametrize(
    "params",
    [
        {"recorded_field": "username"},
        {"recorded_value": "actor"},
        {"recorded_field": "raw_data", "recorded_value": "actor"},
        {"recorded_field": "user_id", "recorded_value": "1"},
        {"recorded_field": "username", "recorded_value": ""},
        {"recorded_field": "username", "recorded_value": "   "},
        {"recorded_field": "username", "recorded_value": "x" * 1025},
        {"recorded_field": "username", "recorded_value": "nul\0label"},
    ],
)
def test_bad_or_partial_scope_is_rejected_in_list_export_and_saved_view_without_queries(ledger, params):
    client = ledger[0]
    statements = []
    event.listen(Engine, "before_cursor_execute", listener := lambda _c, _u, sql, _p, _x, _m: statements.append(sql))
    try:
        for path in ["/api/v1/events/", "/api/v1/events/export"]:
            response = client.get(path, params=params)
            assert response.status_code == 422, response.text
        assert statements == []
        response = client.post("/api/v1/events/views/", json={"name": "Invalid exact view", "filters": params})
        assert response.status_code == 422, response.text
    finally:
        event.remove(Engine, "before_cursor_execute", listener)


def test_owned_records_only_even_for_admin_and_active_auth_required(ledger):
    client, _owner, other, _, _ = ledger
    ids = seed(ledger, [{"username": "actor"}, {"username": "actor", "owner": other.id}])
    params = {"recorded_field": "username", "recorded_value": "actor"}
    data = client.get("/api/v1/events/", params=params).json()
    assert data["total"] == 1 and data["events"][0]["id"] == ids[0]
    other.role = "admin"

    async def other_user():
        return other

    app.dependency_overrides[get_current_user] = other_user
    data = client.get("/api/v1/events/", params=params).json()
    assert data["total"] == 1 and data["events"][0]["id"] == ids[1]
    rows = list(csv.DictReader(io.StringIO(client.get("/api/v1/events/export", params=params).text)))
    assert [int(row["id"]) for row in rows] == [ids[1]]
    other.is_active = False
    assert client.get("/api/v1/events/", params=params).status_code == 400
    assert client.get("/api/v1/events/export", params=params).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get("/api/v1/events/", params=params).status_code == 401


def test_saved_view_roundtrip_preserves_exact_unicode_and_spaces_without_event_ids_or_page(ledger):
    client = ledger[0]
    filters = {"recorded_field": "username", "recorded_value": "  नमस्ते 😀_%  ", "source_id": 7, "sort": "timestamp_asc"}
    created = client.post("/api/v1/events/views/", json={"name": "Exact actor", "filters": filters})
    assert created.status_code == 201, created.text
    assert created.json()["filters"] == filters
    assert client.get("/api/v1/events/views/").json()[0]["filters"] == filters
    assert (
        client.post("/api/v1/events/views/", json={"name": "No page", "filters": {**filters, "page": 2}}).status_code
        == 422
    )


@pytest.mark.parametrize("field", ["username", "hostname", "domain", "action", "source_type"])
def test_new_csv_identity_columns_neutralize_formula_cells_and_preserve_quoting(ledger, field):
    client = ledger[0]
    text = ' \t=UNTRUSTED("a,b")\nnext'
    seed(ledger, [{field: text}])
    response = client.get("/api/v1/events/export")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert rows[0][field] == "'" + text


def test_unicode_codepoint_limit_matches_without_normalizing_distinct_strings(ledger):
    client = ledger[0]
    text = "😀" * 1024
    ids = seed(ledger, [{"username": text}, {"username": "é"}, {"username": "e\u0301"}])
    response = client.get("/api/v1/events/", params={"recorded_field": "username", "recorded_value": text})
    assert response.status_code == 200 and response.json()["events"][0]["id"] == ids[0]
    response = client.get("/api/v1/events/", params={"recorded_field": "username", "recorded_value": "é"})
    assert response.json()["total"] == 1 and response.json()["events"][0]["id"] == ids[1]
