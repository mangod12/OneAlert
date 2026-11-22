"""Exact draft receipt listing never runs events or discloses retained result payloads."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger
from test_hunt_query_drafts import PATH, execute, prepare, setup

from backend.main import app
from backend.models.case import AgentRun
from backend.models.detection_rule import HuntSession
from backend.routers.auth import get_current_user


def listing(ledger, draft, **params):
    return ledger[0].get(
        f"{PATH}/{draft['session_id']}/executions", params={"fingerprint": draft["fingerprint"], **params}
    )


def claim(ledger, draft, *, owner=None, numbers=None, fingerprint=None, run_id=None, status="failed"):
    with ledger[-1]() as db:
        row = HuntSession(
            user_id=owner or ledger[1].id,
            hypothesis="Not returned by receipt list",
            status=status,
            queries_run=0,
            findings_count=0,
            result_data={
                "reviewed_draft": {
                    "session_id": draft["session_id"],
                    "fingerprint": fingerprint or draft["fingerprint"],
                    "query_numbers": [2] if numbers is None else numbers,
                    "scope": "Recorded selection metadata",
                },
                "agent_run_id": run_id,
                "query_results": [
                    {
                        "rows": [{"secret_telemetry": "MUST-NOT-LEAK"}],
                        "query": {"sql": "MUST-NOT-LEAK", "params": {"keyword": "MUST-NOT-LEAK"}},
                    }
                ],
            },
        )
        db.add(row)
        db.commit()
        return row.id


def test_lists_exact_selected_receipts_without_query_rows_provider_or_event_reads(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    result = execute(ledger, draft).json()["data"]
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        response = listing(ledger, draft)
        assert response.status_code == 200, response.text
        data = response.json()
        row = data["executions"][0]
        assert data["source_session_id"] == draft["session_id"] and data["source_fingerprint"] == draft["fingerprint"]
        assert data["offset"] == 0 and data["limit"] == 10 and data["total"] == 1
        assert row["session_id"] == result["session_id"] and row["query_numbers"] == [2]
        assert row["receipt_supported"] and row["agent_run_id"] == result["agent_run_id"]
        assert row["status"] == "completed" and row["recorded_queries_run"] == 1
        assert "query_results" not in response.text and "OWNED-RETAINED" not in response.text
        assert "SELECT id" not in response.text and "hypothesis" not in response.text
        assert not any("security_events" in statement for statement in statements)
        assert provider.complete_json.await_count == 1 and len(calls) == 1
    finally:
        event.remove(Engine, "before_cursor_execute", record)


def test_pages_newest_matching_owned_claims_only_and_never_returns_payloads(ledger, monkeypatch):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    ids = [claim(ledger, draft) for _ in range(23)]
    claim(ledger, draft, owner=ledger[2].id)
    claim(ledger, draft, fingerprint="f" * 64)
    first = listing(ledger, draft).json()
    second = listing(ledger, draft, offset=10).json()
    third = listing(ledger, draft, offset=20).json()
    assert first["total"] == second["total"] == third["total"] == 23
    assert [row["session_id"] for page in [first, second, third] for row in page["executions"]] == list(reversed(ids))
    assert "MUST-NOT-LEAK" not in str([first, second, third])
    assert listing(ledger, draft, offset=30).json()["executions"] == []


@pytest.mark.parametrize("numbers", [[], [True], ["2"], [2, 2], [2, 1], [3], [4], [{"bad": 1}]])
def test_malformed_or_unsupported_selection_claims_remain_visible_without_false_verified_numbers(
    ledger, monkeypatch, numbers
):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    identity = claim(ledger, draft, numbers=numbers)
    data = listing(ledger, draft).json()
    assert data["total"] == 1 and data["executions"][0]["session_id"] == identity
    assert data["executions"][0]["receipt_supported"] is False and data["executions"][0]["query_numbers"] is None


@pytest.mark.parametrize("mode", ["foreign", "other_agent", "missing", "object", "bool"])
def test_run_links_require_a_positive_owned_hunt_run_not_a_similar_or_malformed_reference(ledger, monkeypatch, mode):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    with ledger[-1]() as db:
        run = AgentRun(
            user_id=ledger[2].id if mode == "foreign" else ledger[1].id,
            agent_type="triage" if mode == "other_agent" else "hunt",
        )
        db.add(run)
        db.commit()
        run_id = run.id
    if mode == "missing":
        run_id = 2147483647
    if mode == "object":
        run_id = {"run": run_id}
    if mode == "bool":
        run_id = True
    claim(ledger, draft, run_id=run_id)
    response = listing(ledger, draft)
    assert response.status_code == 200, response.text
    assert response.json()["executions"][0]["agent_run_id"] is None


def test_changed_source_fingerprint_is_refused_without_a_replacement_or_history_fallback(ledger, monkeypatch):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    claim(ledger, draft)
    with ledger[-1]() as db:
        saved = db.get(HuntSession, draft["session_id"])
        data = deepcopy(saved.result_data)
        data["query_draft"]["explanation"] = "Changed source"
        saved.result_data = data
        db.commit()
    assert listing(ledger, draft).status_code == 409


def test_expired_source_can_read_its_own_receipts_without_renewing_availability(ledger, monkeypatch):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    with ledger[-1]() as db:
        saved = db.get(HuntSession, draft["session_id"])
        data = deepcopy(saved.result_data)
        now = datetime.now(UTC)
        data["query_draft"].update(
            prepared_at=(now - timedelta(hours=2)).isoformat(), expires_at=(now - timedelta(hours=1)).isoformat()
        )
        saved.result_data = data
        db.commit()
    expired = ledger[0].get(f"{PATH}/{draft['session_id']}").json()
    assert not expired["can_execute"]
    claim(ledger, expired)
    assert listing(ledger, expired).json()["total"] == 1
    assert ledger[0].get(f"{PATH}/{draft['session_id']}").json()["can_execute"] is False


@pytest.mark.parametrize(
    "params",
    [
        {"offset": -1},
        {"offset": 10001},
        {"limit": 0},
        {"limit": 21},
        {"fingerprint": "bad"},
        {"fingerprint": "a" * 64 + "\n"},
    ],
)
def test_invalid_page_parameters_are_refused(ledger, monkeypatch, params):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    assert listing(ledger, draft, **params).status_code == 422


def test_foreign_admin_inactive_and_anonymous_cannot_list_receipts(ledger, monkeypatch):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    claim(ledger, draft)
    _, owner, other, _, _ = ledger
    other.role = "admin"
    app.dependency_overrides[get_current_user] = lambda: other
    hidden = listing(ledger, draft)
    absent = listing(ledger, {**draft, "session_id": 2147483647})
    assert hidden.status_code == absent.status_code == 404 and hidden.json()["error"] == absent.json()["error"]
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert listing(ledger, draft).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert listing(ledger, draft).status_code == 401


@pytest.mark.parametrize("reference", ["not-a-number", {"bad": 1}, [1]])
def test_malformed_source_references_do_not_require_an_unsafe_integer_cast(ledger, monkeypatch, reference):
    setup(ledger, monkeypatch)
    draft = prepare(ledger)
    identity = claim(ledger, draft)
    with ledger[-1]() as db:
        saved = db.get(HuntSession, identity)
        data = deepcopy(saved.result_data)
        data["reviewed_draft"]["session_id"] = reference
        saved.result_data = data
        db.commit()
    response = listing(ledger, draft)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0
