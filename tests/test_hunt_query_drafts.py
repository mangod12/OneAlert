"""Generation compiles only; executing chosen stored queries is a separate owner-scoped action."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.case import AgentRun, AgentStep
from backend.models.detection_rule import HuntSession
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_current_user
from backend.services.agents.hunt import HuntAgent

PATH = "/api/v1/hunt/query-drafts"
SQL = "SELECT id, signature FROM security_events WHERE user_id = :user_id ORDER BY id ASC LIMIT 100"


def setup(ledger, monkeypatch, response=None):
    queries = [
        {"description": "Current selected event metadata", "sql": SQL},
        {
            "description": "Fixed saved UTC window",
            "sql": SQL.replace(" ORDER BY", " AND timestamp >= :since AND timestamp < :before ORDER BY"),
            "params": {"since": "2026-01-01T00:00:00Z", "before": "2027-01-01T00:00:00Z"},
        },
        {"description": "Unsupported write", "sql": "DELETE FROM security_events WHERE user_id = :user_id"},
    ]
    provider = SimpleNamespace(
        model="fixture-model",
        complete_json=AsyncMock(
            return_value=response
            if response is not None
            else {
                "queries": queries,
                "explanation": "Proposed tests, not findings",
                "sigma_rule": "NOT-SAVED-OR-INSTALLED",
            }
        ),
    )
    monkeypatch.setattr("backend.services.agents.hunt.get_ai_provider", lambda _: provider)
    calls = []
    original = HuntAgent._execute_compiled_query

    async def tracked(agent, query):
        calls.append(query)
        return await original(agent, query)

    monkeypatch.setattr(HuntAgent, "_execute_compiled_query", tracked)
    with ledger[-1]() as db:
        db.add_all(
            [
                SecurityEvent(
                    user_id=ledger[1].id,
                    timestamp=datetime(2026, 11, 1, tzinfo=UTC),
                    event_type="alert",
                    signature="OWNED-RETAINED",
                ),
                SecurityEvent(
                    user_id=ledger[2].id,
                    timestamp=datetime(2026, 11, 1, tzinfo=UTC),
                    event_type="alert",
                    signature="FOREIGN-NOT-RETURNED",
                ),
            ]
        )
        db.commit()
    return provider, calls


def prepare(ledger):
    response = ledger[0].post(PATH, json={"hypothesis": "Inspect only owned event metadata"})
    assert response.status_code == 200, response.text
    assert response.json()["success"], response.text
    return response.json()["data"]


def execute(ledger, draft, numbers=None, **extra):
    return ledger[0].post(
        f"{PATH}/{draft['session_id']}/execute",
        json={"fingerprint": draft["fingerprint"], "query_numbers": [2] if numbers is None else numbers, **extra},
    )


def test_prepare_never_reads_events_then_chosen_original_query_executes_without_another_provider_call(
    ledger, monkeypatch
):
    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    assert calls == [] and provider.complete_json.await_count == 1
    assert draft["draft"]["generation_method"] == "provider_response" and draft["can_execute"]
    assert [query["accepted"] for query in draft["draft"]["queries"]] == [True, True, False]
    assert draft["draft"]["queries"][1]["execution"]["row_limit"] == 100
    assert draft["draft"]["queries"][1]["time_window"]["since"] == "2026-01-01T00:00:00+00:00"
    assert "NOT-SAVED" not in str(draft) and "OWNED-RETAINED" not in str(draft)
    with ledger[-1]() as db:
        source = db.get(HuntSession, draft["session_id"])
        assert source.status == "prepared" and source.queries_run == source.findings_count == 0
        assert source.completed_at is None and source.sigma_rule is None
        db.add(
            SecurityEvent(
                user_id=ledger[1].id,
                timestamp=datetime(2026, 11, 2, tzinfo=UTC),
                event_type="alert",
                signature="OWNED-ADDED-AFTER-PREPARATION",
            )
        )
        db.commit()
    result = execute(ledger, draft).json()["data"]
    assert provider.complete_json.await_count == 1 and len(calls) == 1
    assert result["session_id"] != draft["session_id"] and result["agent_run_id"] != draft["agent_run_id"]
    assert result["status"] == "completed" and result["execution_summary"]["attempted"] == 1
    assert result["reviewed_draft"]["query_numbers"] == [2]
    query = result["query_results"][0]
    assert query["query"]["reviewed_query_number"] == 2
    assert query["time_window"] == draft["draft"]["queries"][1]["time_window"]
    assert len(query["rows"]) == 2 and "FOREIGN-NOT-RETURNED" not in str(result)
    assert "OWNED-ADDED-AFTER-PREPARATION" in str(result) and result["sigma_rule"] is None
    reopened = ledger[0].get(f"{PATH}/{draft['session_id']}").json()
    assert reopened["fingerprint"] == draft["fingerprint"]
    with ledger[-1]() as db:
        step = db.query(AgentStep).filter(AgentStep.run_id == result["agent_run_id"]).all()
        assert [item.action for item in step] == ["use_reviewed_hunt_query_draft", "execute_query"]
        assert db.get(HuntSession, draft["session_id"]).status == "prepared"
    history = ledger[0].get("/api/v1/hunt/history", params={"state": "prepared"}).json()
    assert [row["id"] for row in history["sessions"]] == [draft["session_id"]]


@pytest.mark.parametrize("change", ["hypothesis", "sql", "explanation"])
def test_changed_saved_context_refuses_old_review_without_new_session_provider_or_event_query(
    ledger, monkeypatch, change
):
    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    with ledger[-1]() as db:
        source = db.get(HuntSession, draft["session_id"])
        if change == "hypothesis":
            source.hypothesis = "Different source hypothesis"
        else:
            data = deepcopy(source.result_data)
            if change == "sql":
                data["query_draft"]["queries"][1]["sql"] = SQL
            else:
                data["query_draft"]["explanation"] = "Changed proposal context"
            source.result_data = data
        db.commit()
    assert execute(ledger, draft).status_code == 409
    assert calls == [] and provider.complete_json.await_count == 1
    with ledger[-1]() as db:
        assert db.query(HuntSession).count() == 1


@pytest.mark.parametrize("mode", ["expired", "future", "compiler_contract"])
def test_expired_future_or_changed_compiler_contract_cannot_execute_even_with_reloaded_fingerprint(
    ledger, monkeypatch, mode
):
    _, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    with ledger[-1]() as db:
        source = db.get(HuntSession, draft["session_id"])
        data = deepcopy(source.result_data)
        if mode == "compiler_contract":
            data["query_draft"]["queries"][1]["execution"]["row_limit"] = 999
        else:
            prepared = datetime.now(UTC) + timedelta(hours=-2 if mode == "expired" else 2)
            data["query_draft"].update(
                prepared_at=prepared.isoformat(), expires_at=(prepared + timedelta(hours=1)).isoformat()
            )
        source.result_data = data
        db.commit()
    loaded = ledger[0].get(f"{PATH}/{draft['session_id']}").json()
    if mode != "compiler_contract":
        assert not loaded["can_execute"]
    assert execute(ledger, loaded).status_code == 409 and calls == []


def test_foreign_admin_inactive_and_anonymous_have_no_draft_or_execution_access(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    client, owner, other, _, _ = ledger
    other.role = "admin"
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(f"{PATH}/{draft['session_id']}").status_code == 404
    assert execute(ledger, draft).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert execute(ledger, draft).status_code == 400
    assert client.post(PATH, json={"hypothesis": "Not authorized"}).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert execute(ledger, draft).status_code == 401
    assert provider.complete_json.await_count == 1 and calls == []


def test_invalid_or_rejected_selection_never_starts_an_execution(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    for numbers in [[], [1, 1], [True], [1.0], ["1"], [0], [4], [1, 2, 3, 1]]:
        assert execute(ledger, draft, numbers=numbers).status_code == 422
    assert execute(ledger, draft, extra_sql=SQL).status_code == 422
    assert execute(ledger, draft, numbers=[3]).status_code == 409
    assert calls == [] and provider.complete_json.await_count == 1


@pytest.mark.parametrize("response", [{}, {"queries": []}, {"queries": "not a list"}, []])
def test_malformed_generation_saves_failure_not_empty_success(ledger, monkeypatch, response):
    provider, calls = setup(ledger, monkeypatch, response)
    result = ledger[0].post(PATH, json={"hypothesis": "Try generating a draft"}).json()
    assert result["success"] is False and result["data"]["status"] == "failed"
    assert calls == [] and provider.complete_json.await_count == 1
    with ledger[-1]() as db:
        assert db.get(AgentRun, result["data"]["agent_run_id"]).status == "failed"
        assert db.get(HuntSession, result["data"]["session_id"]).status == "failed"


def test_provider_failure_saves_fallback_draft_without_executing_it(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    provider.complete_json.side_effect = RuntimeError("provider unavailable")
    draft = prepare(ledger)
    assert draft["draft"]["generation_method"] == "keyword_fallback"
    assert all(query["accepted"] for query in draft["draft"]["queries"]) and calls == []
    execute(ledger, draft, numbers=[1])
    assert len(calls) == 1 and provider.complete_json.await_count == 1


def test_draft_caps_queries_descriptions_explanations_and_never_accepts_extra_provider_parameters(ledger, monkeypatch):
    response = {
        "queries": [
            {"sql": SQL, "description": "🛡" * 1001},
            {"sql": SQL, "params": {"credential": "NOT-RETAINED"}},
            {"sql": SQL, "params": {"keyword": 4}},
            {"sql": SQL},
        ],
        "explanation": "E" * 4001,
    }
    _, calls = setup(ledger, monkeypatch, response)
    draft = prepare(ledger)["draft"]
    assert len(draft["queries"]) == 3 and draft["omitted_query_count"] == 1
    assert len(draft["queries"][0]["description"]) == 1000 and draft["queries"][0]["description_shortened"]
    assert len(draft["explanation"]) == 4000 and draft["explanation_shortened"]
    assert [query["accepted"] for query in draft["queries"]] == [True, False, False]
    assert "NOT-RETAINED" not in str(draft) and calls == []


def test_unused_or_missing_parameters_do_not_make_a_draft_look_time_scoped(ledger, monkeypatch):
    response = {
        "queries": [
            {"sql": SQL, "params": {"since": "2026-01-01T00:00:00Z"}},
            {"sql": SQL.replace(" ORDER BY", " AND timestamp >= :since ORDER BY")},
            {"sql": SQL.replace(" ORDER BY", " AND signature LIKE ':since' ORDER BY")},
        ]
    }
    _, calls = setup(ledger, monkeypatch, response)
    queries = prepare(ledger)["draft"]["queries"]
    assert [query["accepted"] for query in queries] == [False, False, True]
    assert queries[2]["params"] == {} and queries[2]["time_window"] == {} and calls == []


def test_preparation_and_reopening_issue_no_security_event_select_even_outside_the_execution_helper(
    ledger, monkeypatch
):
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    setup(ledger, monkeypatch)
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT") and "security_events" in statement:
            statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        draft = prepare(ledger)
        assert ledger[0].get(f"{PATH}/{draft['session_id']}").status_code == 200
        assert statements == []
        assert execute(ledger, draft).status_code == 200
        assert len(statements) == 1
    finally:
        event.remove(Engine, "before_cursor_execute", record)


def test_reviewed_query_with_timestamp_fields_persists_a_json_safe_separate_result(ledger, monkeypatch):
    setup(
        ledger,
        monkeypatch,
        {"queries": [{"sql": SQL.replace("SELECT id, signature", "SELECT id, timestamp, signature")}]},
    )
    draft = prepare(ledger)
    response = execute(ledger, draft, numbers=[1])
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["query_results"][0]["rows"][0]["timestamp"] == "2026-11-01T00:00:00"
    saved = ledger[0].get(f"/api/v1/hunt/{data['session_id']}").json()
    assert saved["result_data"]["query_results"] == data["query_results"]


def test_legacy_direct_hunt_also_persists_timestamp_rows_without_changing_other_scalar_values(ledger, monkeypatch):
    setup(
        ledger,
        monkeypatch,
        {"queries": [{"sql": SQL.replace("SELECT id, signature", "SELECT id, timestamp, signature, processed")}]},
    )
    response = ledger[0].post("/api/v1/hunt/", json={"hypothesis": "Legacy direct hunt timestamp regression"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["status"] == "completed"
    row = data["query_results"][0]["rows"][0]
    assert row["timestamp"] == "2026-11-01T00:00:00" and type(row["id"]) is int and row["processed"] == "pending"
    reopened = ledger[0].get(f"/api/v1/hunt/{data['session_id']}").json()
    assert reopened["result_data"]["query_results"] == data["query_results"]


def test_terminal_execution_exception_retains_owned_run_and_exact_reviewed_source_without_fake_results(
    ledger, monkeypatch
):
    from backend.services.hunt_query_drafts import ReviewedHuntQueriesAgent

    provider, calls = setup(ledger, monkeypatch)
    draft = prepare(ledger)
    monkeypatch.setattr(ReviewedHuntQueriesAgent, "run", AsyncMock(side_effect=RuntimeError("fixture interrupted")))
    response = execute(ledger, draft)
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["status"] == "failed" and result["reviewed_draft"]["session_id"] == draft["session_id"]
    assert result["reviewed_draft"]["fingerprint"] == draft["fingerprint"]
    assert "execution_summary" not in result and "query_results" not in result
    assert calls == [] and provider.complete_json.await_count == 1
    with ledger[-1]() as db:
        assert db.get(AgentRun, result["agent_run_id"]).status == "failed"
        assert db.get(HuntSession, result["session_id"]).result_data["reviewed_draft"] == result["reviewed_draft"]
