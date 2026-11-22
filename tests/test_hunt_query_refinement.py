"""Analyst edits make a new compiler-only draft, never mutate or run the saved source."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger
from test_hunt_query_drafts import PATH, SQL, execute, prepare, setup

from backend.main import app
from backend.models.case import AgentRun, AgentStep
from backend.models.detection_rule import HuntSession
from backend.routers.auth import get_current_user


def refine(ledger, draft, edits=None, **extra):
    return ledger[0].post(
        f"{PATH}/{draft['session_id']}/refinements",
        json={
            "fingerprint": draft["fingerprint"],
            "edits": [{"position": 3, "sql": SQL, "params": {}}] if edits is None else edits,
            **extra,
        },
    )


def test_refinement_compiles_without_provider_or_event_read_and_preserves_exact_source(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    original = prepare(ledger)
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT") and "security_events" in statement:
            statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        response = refine(ledger, original)
        assert response.status_code == 200, response.text
        child = response.json()["data"]
        assert response.json()["success"] and child["can_execute"]
        assert child["session_id"] != original["session_id"]
        assert child["agent_run_id"] != original["agent_run_id"]
        assert child["fingerprint"] != original["fingerprint"]
        assert child["draft"]["generation_method"] == "analyst_refinement"
        lineage = child["draft"]["refinement"]
        assert lineage["source_session_id"] == original["session_id"]
        assert lineage["source_fingerprint"] == original["fingerprint"]
        assert lineage["source_prepared_at"] == original["draft"]["prepared_at"]
        assert lineage["edited_query_numbers"] == [3]
        assert all(query["accepted"] for query in child["draft"]["queries"])
        assert child["draft"]["queries"][:2] == original["draft"]["queries"][:2]
        assert statements == [] and calls == [] and provider.complete_json.await_count == 1
        reopened = ledger[0].get(f"{PATH}/{original['session_id']}").json()
        assert reopened["fingerprint"] == original["fingerprint"]
        assert reopened["draft"] == original["draft"]
        assert ledger[0].get(f"{PATH}/{child['session_id']}").json()["fingerprint"] == child["fingerprint"]
        result = execute(ledger, child, numbers=[3]).json()["data"]
        assert result["reviewed_draft"]["session_id"] == child["session_id"]
        assert result["reviewed_draft"]["query_numbers"] == [3]
        assert result["query_results"][0]["query"]["sql"] == SQL
        assert len(statements) == len(calls) == 1 and provider.complete_json.await_count == 1
        assert "FOREIGN-NOT-RETURNED" not in str(result)
        with ledger[-1]() as db:
            saved = db.get(HuntSession, child["session_id"])
            assert saved.status == "prepared" and saved.queries_run == saved.findings_count == 0
            assert saved.completed_at is None and saved.sigma_rule is None
            assert db.get(AgentRun, child["agent_run_id"]).model_used is None
            steps = db.query(AgentStep).filter(AgentStep.run_id == child["agent_run_id"]).all()
            assert [step.action for step in steps] == ["refine_saved_hunt_queries", "prepare_hunt_query_draft"]
    finally:
        event.remove(Engine, "before_cursor_execute", record)


def test_explicit_parameter_edit_changes_only_new_bound_and_preserves_other_original_queries(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    query = source["draft"]["queries"][1]
    edited = {"position": 2, "sql": query["sql"], "params": {**query["params"], "before": "2026-12-01T00:00:00Z"}}
    response = refine(ledger, source, [edited])
    assert response.status_code == 200, response.text
    child = response.json()["data"]
    assert child["draft"]["queries"][1]["time_window"] == {
        "since": "2026-01-01T00:00:00+00:00", "before": "2026-12-01T00:00:00+00:00",
    }
    assert child["draft"]["queries"][0] == source["draft"]["queries"][0]
    assert child["draft"]["queries"][2] == source["draft"]["queries"][2]
    assert child["draft"]["refinement"]["edited_query_numbers"] == [2]
    assert provider.complete_json.await_count == 1 and calls == []


@pytest.mark.parametrize("sql,params", [
    ("DELETE FROM security_events WHERE user_id=:user_id", {}),
    (SQL.replace(" WHERE user_id = :user_id", ""), {}),
    (SQL, {"since": "2026-01-01T00:00:00Z"}),
    (SQL.replace(" ORDER BY", " AND timestamp >= :since ORDER BY"), {}),
    (SQL.replace(" ORDER BY", " AND timestamp >= :since ORDER BY"), {"since": "not-a-date"}),
])
def test_unsupported_edits_are_saved_rejected_not_executed(ledger, monkeypatch, sql, params):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    response = refine(ledger, source, [{"position": 1, "sql": sql, "params": params}])
    assert response.status_code == 200, response.text
    child = response.json()["data"]
    assert child["draft"]["queries"][0]["accepted"] is False
    assert child["draft"]["queries"][0]["sql"] == sql
    assert child["draft"]["queries"][0]["params"] == params
    assert execute(ledger, child, numbers=[1]).status_code == 409
    assert calls == [] and provider.complete_json.await_count == 1


def test_changed_source_and_noop_or_invalid_edit_requests_create_no_new_run(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    original = source["draft"]["queries"][0]
    unchanged = [{"position": 1, "sql": original["sql"], "params": original["params"]}]
    assert refine(ledger, source, unchanged).status_code == 422
    for edits in [[], [{"position": True, "sql": SQL}], [{"position": 1.0, "sql": SQL}],
                  [{"position": "1", "sql": SQL}], [{"position": 4, "sql": SQL}],
                  [{"position": 1, "sql": SQL}, {"position": 1, "sql": SQL}],
                  [{"position": 1, "sql": "X" * 12001}],
                  [{"position": 1, "sql": SQL, "params": {"secret": "forbidden"}}],
                  [{"position": 1, "sql": SQL, "params": {"keyword": "X" * 2049}}],
                  [{"position": 1, "sql": SQL, "params": {"keyword": 3}}],
                  [{"position": 1, "sql": SQL, "target": "unsupported"}]]:
        assert refine(ledger, source, edits).status_code == 422
    assert refine(ledger, source, unrelated="unsupported").status_code == 422
    with ledger[-1]() as db:
        saved = db.get(HuntSession, source["session_id"])
        data = deepcopy(saved.result_data)
        data["query_draft"]["explanation"] = "Changed saved source"
        saved.result_data = data
        db.commit()
    assert refine(ledger, source).status_code == 409
    assert calls == [] and provider.complete_json.await_count == 1
    with ledger[-1]() as db:
        assert db.query(HuntSession).count() == 1
        assert db.query(AgentRun).filter(AgentRun.agent_type == "hunt").count() == 1


def test_foreign_admin_inactive_and_anonymous_cannot_refine(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    _, owner, other, _, _ = ledger
    other.role = "admin"
    app.dependency_overrides[get_current_user] = lambda: other
    hidden = refine(ledger, source)
    absent = refine(ledger, {**source, "session_id": 2147483647})
    assert hidden.status_code == absent.status_code == 404
    assert hidden.json()["error"] == absent.json()["error"]
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert refine(ledger, source).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert refine(ledger, source).status_code == 401
    assert provider.complete_json.await_count == 1 and calls == []


def test_shortening_and_omission_provenance_survive_refinement_and_no_missing_queries_are_recovered(
    ledger, monkeypatch,
):
    setup(ledger, monkeypatch, {
        "queries": [{"sql": SQL, "description": "🛡" * 1001}] * 5,
        "explanation": "E" * 4001,
    })
    source = prepare(ledger)
    child = refine(ledger, source, [{"position": 2, "sql": SQL.replace("LIMIT 100", "LIMIT 20")}]).json()["data"]
    assert len(child["draft"]["queries"]) == 3 and child["draft"]["generated_query_count"] == 3
    assert child["draft"]["omitted_query_count"] == 0
    assert child["draft"]["refinement"]["source_omitted_query_count"] == 2
    assert all(query["description_shortened"] for query in child["draft"]["queries"])
    assert child["draft"]["explanation_shortened"] and len(child["draft"]["explanation"]) == 4000
    assert child["draft"]["queries"][1]["execution"]["row_limit"] == 20


def test_expired_draft_can_be_explicitly_refined_but_does_not_advance_saved_absolute_bounds(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    with ledger[-1]() as db:
        saved = db.get(HuntSession, source["session_id"])
        data = deepcopy(saved.result_data)
        prepared = datetime.now(UTC) - timedelta(hours=2)
        data["query_draft"].update(
            prepared_at=prepared.isoformat(), expires_at=(prepared + timedelta(hours=1)).isoformat(),
        )
        saved.result_data = data
        db.commit()
    expired = ledger[0].get(f"{PATH}/{source['session_id']}").json()
    assert not expired["can_execute"]
    child = refine(ledger, expired).json()["data"]
    assert child["can_execute"]
    assert child["draft"]["queries"][1]["time_window"] == expired["draft"]["queries"][1]["time_window"]
    assert child["draft"]["refinement"]["source_prepared_at"] == expired["draft"]["prepared_at"]
    assert provider.complete_json.await_count == 1 and calls == []


@pytest.mark.parametrize("mode", [
    "self_source", "bool_source", "hash_newline", "duplicate", "unsorted", "bad_date",
    "naive_date", "empty_scope", "omitted", "count", "method", "missing_lineage",
])
def test_corrupted_refinement_provenance_refuses_read_execute_and_refine_before_creating_another_run(
    ledger, monkeypatch, mode,
):
    from sqlalchemy.orm.attributes import flag_modified

    from backend.services.hunt_query_drafts import draft_fingerprint

    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    child = refine(ledger, source).json()["data"]
    with ledger[-1]() as db:
        saved = db.get(HuntSession, child["session_id"])
        data = deepcopy(saved.result_data)
        draft = data["query_draft"]
        lineage = draft["refinement"]
        if mode == "self_source":
            lineage["source_session_id"] = child["session_id"]
        elif mode == "bool_source":
            lineage["source_session_id"] = True
        elif mode == "hash_newline":
            lineage["source_fingerprint"] += "\n"
        elif mode == "duplicate":
            lineage["edited_query_numbers"] = [3, 3]
        elif mode == "unsorted":
            lineage["edited_query_numbers"] = [2, 1]
        elif mode in {"bad_date", "naive_date"}:
            lineage["source_prepared_at"] = "bad-date" if mode == "bad_date" else "2026-11-22T00:00:00"
        elif mode == "empty_scope":
            lineage["scope"] = ""
        elif mode == "omitted":
            draft["omitted_query_count"] = 1
        elif mode == "count":
            draft["generated_query_count"] = True
        elif mode == "method":
            draft["generation_method"] = "provider_response"
        else:
            draft["refinement"] = None
        saved.result_data = data
        # Python compares True equal to source ID 1. Force this corruption
        # fixture to reach SQLite rather than being skipped as unchanged JSON.
        flag_modified(saved, "result_data")
        db.commit()
        corrupt = {**child, "fingerprint": draft_fingerprint(saved.id, saved.hypothesis, draft)}
    assert ledger[0].get(f"{PATH}/{child['session_id']}").status_code == 409
    assert execute(ledger, corrupt, numbers=[1]).status_code == 409
    assert refine(ledger, corrupt, [{"position": 1, "sql": SQL.replace("LIMIT 100", "LIMIT 20")}]).status_code == 409
    assert provider.complete_json.await_count == 1 and calls == []
    with ledger[-1]() as db:
        assert db.query(HuntSession).count() == 2
        assert db.query(AgentRun).filter(AgentRun.agent_type == "hunt").count() == 2


def test_refinement_can_be_refined_again_without_losing_original_positions_or_mutating_ancestors(ledger, monkeypatch):
    provider, calls = setup(ledger, monkeypatch)
    source = prepare(ledger)
    child = refine(ledger, source).json()["data"]
    response = refine(ledger, child, [{"position": 1, "sql": SQL.replace("LIMIT 100", "LIMIT 20")}])
    assert response.status_code == 200, response.text
    grandchild = response.json()["data"]
    assert grandchild["draft"]["refinement"]["source_session_id"] == child["session_id"]
    assert grandchild["draft"]["refinement"]["source_fingerprint"] == child["fingerprint"]
    assert grandchild["draft"]["refinement"]["edited_query_numbers"] == [1]
    assert grandchild["draft"]["queries"][2] == child["draft"]["queries"][2]
    assert ledger[0].get(f"{PATH}/{source['session_id']}").json()["draft"] == source["draft"]
    assert ledger[0].get(f"{PATH}/{child['session_id']}").json()["draft"] == child["draft"]
    assert provider.complete_json.await_count == 1 and calls == []
