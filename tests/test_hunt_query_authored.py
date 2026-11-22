"""Analyst-authored drafts compile without a provider or security-event read."""

from copy import deepcopy

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger
from test_hunt_query_drafts import PATH, SQL, execute, setup

from backend.main import app
from backend.models.case import AgentRun, AgentStep
from backend.models.detection_rule import HuntSession
from backend.routers.auth import get_current_user


def author(ledger, queries=None, **extra):
    return ledger[0].post(
        f"{PATH}/authored",
        json={
            "hypothesis": "Analyst review of owned event metadata",
            "queries": [{"position": 1, "description": "My exact query", "sql": SQL, "params": {}}]
            if queries is None
            else queries,
            **extra,
        },
    )


def test_authored_draft_compiles_without_provider_or_event_select_and_executes_only_on_selection(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT") and "security_events" in statement:
            statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        response = author(ledger)
        assert response.status_code == 200, response.text
        draft = response.json()["data"]
        assert response.json()["success"] and draft["can_execute"]
        assert draft["draft"]["generation_method"] == "analyst_authored"
        assert draft["draft"]["queries"][0]["sql"] == SQL
        assert draft["draft"]["queries"][0]["description"] == "My exact query"
        assert draft["draft"]["generated_query_count"] == 1 and draft["draft"]["omitted_query_count"] == 0
        assert draft["draft"]["explanation"] is None and "refinement" not in draft["draft"]
        assert statements == calls == [] and provider.complete_json.await_count == 0
        assert ledger[0].get(f"{PATH}/{draft['session_id']}").json()["fingerprint"] == draft["fingerprint"]
        with ledger[-1]() as db:
            saved = db.get(HuntSession, draft["session_id"])
            assert saved.status == "prepared" and saved.queries_run == saved.findings_count == 0
            assert saved.completed_at is None and saved.sigma_rule is None
            assert db.get(AgentRun, draft["agent_run_id"]).model_used is None
            steps = db.query(AgentStep).filter(AgentStep.run_id == draft["agent_run_id"]).all()
            assert [step.action for step in steps] == ["author_hunt_query_draft", "prepare_hunt_query_draft"]
        result = execute(ledger, draft, numbers=[1]).json()["data"]
        assert result["reviewed_draft"]["session_id"] == draft["session_id"]
        assert result["reviewed_draft"]["query_numbers"] == [1]
        assert "OWNED-RETAINED" in str(result) and "FOREIGN-NOT-RETURNED" not in str(result)
        assert len(statements) == len(calls) == 1 and provider.complete_json.await_count == 0
    finally:
        event.remove(Engine, "before_cursor_execute", record)


@pytest.mark.parametrize(
    "sql,params",
    [
        ("DELETE FROM security_events WHERE user_id=:user_id", {}),
        (SQL.replace(" WHERE user_id = :user_id", ""), {}),
        (SQL, {"keyword": "Unused preserved parameter"}),
        (SQL.replace(" ORDER BY", " AND timestamp >= :since ORDER BY"), {}),
        (SQL.replace(" ORDER BY", " AND timestamp >= :since ORDER BY"), {"since": "not-a-date"}),
    ],
)
def test_unsupported_authored_queries_are_saved_rejected_with_exact_parameters_not_executed(
    ledger, monkeypatch, sql, params
):
    provider, calls = setup(ledger, monkeypatch)
    response = author(ledger, [{"position": 1, "sql": sql, "params": params}])
    assert response.status_code == 200, response.text
    draft = response.json()["data"]
    query = draft["draft"]["queries"][0]
    assert query["accepted"] is False and not draft["can_execute"]
    assert query["sql"] == sql and query["params"] == params
    assert query["execution"] is None and query["time_window"] == {}
    assert execute(ledger, draft, numbers=[1]).status_code == 409
    assert provider.complete_json.await_count == 0 and calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"queries": []},
        {"queries": [{"position": 1, "sql": SQL}] * 4},
        {"queries": [{"position": True, "sql": SQL}]},
        {"queries": [{"position": "1", "sql": SQL}]},
        {"queries": [{"position": 1.0, "sql": SQL}]},
        {"queries": [{"position": 2, "sql": SQL}]},
        {"queries": [{"position": 1, "sql": SQL}, {"position": 1, "sql": SQL}]},
        {"queries": [{"position": 1, "sql": " "}]},
        {"queries": [{"position": 1, "sql": "X" * 12001}]},
        {"queries": [{"position": 1, "sql": SQL, "description": "D" * 1001}]},
        {"queries": [{"position": 1, "sql": SQL, "description": 1}]},
        {"queries": [{"position": 1, "sql": SQL, "params": {"user_id": "2"}}]},
        {"queries": [{"position": 1, "sql": SQL, "params": {"keyword": 1}}]},
        {"queries": [{"position": 1, "sql": SQL, "params": {"keyword": ""}}]},
        {"queries": [{"position": 1, "sql": SQL, "params": {"keyword": "K" * 2049}}]},
        {"queries": [{"position": 1, "sql": SQL, "execute": True}]},
        {"hypothesis": " "},
        {"hypothesis": "H" * 4001},
        {"execute": True},
    ],
)
def test_invalid_authored_input_is_refused_before_a_run_or_draft_is_created(ledger, monkeypatch, change):
    provider, calls = setup(ledger, monkeypatch)
    response = author(ledger, **change)
    assert response.status_code == 422, response.text
    assert provider.complete_json.await_count == 0 and calls == []
    with ledger[-1]() as db:
        assert db.query(HuntSession).count() == 0
        assert db.query(AgentRun).filter(AgentRun.agent_type == "hunt").count() == 0


def test_multiple_authored_queries_keep_exact_bounds_numbering_and_can_be_refined_without_provider(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    params = {"since": "2026-01-01T00:00:00Z", "before": "2027-01-01T00:00:00Z"}
    queries = [
        {"position": 1, "sql": SQL, "description": "First"},
        {
            "position": 2,
            "sql": SQL.replace(" ORDER BY", " AND timestamp >= :since AND timestamp < :before ORDER BY"),
            "params": params,
            "description": "Second",
        },
    ]
    draft = author(ledger, queries).json()["data"]
    before = deepcopy(draft["draft"])
    assert draft["draft"]["queries"][1]["time_window"] == {
        "since": "2026-01-01T00:00:00+00:00",
        "before": "2027-01-01T00:00:00+00:00",
    }
    refined = (
        ledger[0]
        .post(
            f"{PATH}/{draft['session_id']}/refinements",
            json={
                "fingerprint": draft["fingerprint"],
                "edits": [{"position": 2, "sql": queries[1]["sql"].replace("LIMIT 100", "LIMIT 20"), "params": params}],
            },
        )
        .json()["data"]
    )
    assert refined["draft"]["refinement"]["source_session_id"] == draft["session_id"]
    assert refined["draft"]["queries"][1]["execution"]["row_limit"] == 20
    assert ledger[0].get(f"{PATH}/{draft['session_id']}").json()["draft"] == before
    assert provider.complete_json.await_count == 0 and calls == []


def test_foreign_users_cannot_read_or_execute_authored_draft_and_inactive_or_anonymous_cannot_author(
    ledger, monkeypatch
):
    provider, calls = setup(ledger, monkeypatch)
    draft = author(ledger).json()["data"]
    _, owner, other, _, _ = ledger
    other.role = "admin"
    app.dependency_overrides[get_current_user] = lambda: other
    assert ledger[0].get(f"{PATH}/{draft['session_id']}").status_code == 404
    assert execute(ledger, draft, numbers=[1]).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert author(ledger).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert author(ledger).status_code == 401
    assert provider.complete_json.await_count == 0 and calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"generated_query_count": 2, "omitted_query_count": 1},
        {"explanation": "Invented provider conclusion"},
        {"explanation_shortened": True},
    ],
)
def test_corrupted_authored_provenance_refuses_read_and_execution(ledger, monkeypatch, change):
    from backend.services.hunt_query_drafts import draft_fingerprint

    provider, calls = setup(ledger, monkeypatch)
    draft = author(ledger).json()["data"]
    with ledger[-1]() as db:
        saved = db.get(HuntSession, draft["session_id"])
        data = deepcopy(saved.result_data)
        data["query_draft"].update(change)
        saved.result_data = data
        db.commit()
        changed = {**draft, "fingerprint": draft_fingerprint(saved.id, saved.hypothesis, data["query_draft"])}
    assert ledger[0].get(f"{PATH}/{draft['session_id']}").status_code == 409
    assert execute(ledger, changed, numbers=[1]).status_code == 409
    assert provider.complete_json.await_count == 0 and calls == []


def test_interrupted_authored_compilation_keeps_failure_separate_from_a_prepared_draft(ledger, monkeypatch):
    from backend.services.hunt_query_drafts import AuthoredHuntQueryDraftAgent

    provider, calls = setup(ledger, monkeypatch)

    async def interrupted(_agent, _hypothesis):
        raise RuntimeError("Controlled compiler interruption")

    monkeypatch.setattr(AuthoredHuntQueryDraftAgent, "_generate_response", interrupted)
    response = author(ledger)
    assert response.status_code == 200 and response.json()["success"] is False
    result = response.json()["data"]
    assert result["status"] == "failed" and "query_draft" not in result
    assert provider.complete_json.await_count == 0 and calls == []
