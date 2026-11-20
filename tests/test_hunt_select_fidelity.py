"""Execution fidelity for the constrained, owner-bound hunt SELECT contract."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import backend.main  # noqa: F401
from backend.models.security_event import SecurityEvent
from backend.services.agents.hunt import DEFAULT_HUNT_COLUMNS, HuntAgent

BASE = "SELECT id FROM security_events WHERE user_id = :user_id"


def agent():
    instance = HuntAgent.__new__(HuntAgent)
    instance.user_id = 123
    return instance


@pytest.mark.parametrize(
    "sql",
    [
        BASE.replace("SELECT id", "SELECT COUNT(*)"),
        BASE.replace("SELECT id", "SELECT id AS event_id"),
        BASE.replace("SELECT id", "SELECT id, missing"),
        BASE.replace("SELECT id", "SELECT DISTINCT id"),
        BASE.replace("SELECT id", "SELECT id, id"),
        BASE.replace("SELECT id", "SELECT MAX(timestamp)"),
        BASE.replace("SELECT id", "SELECT id + 1"),
        BASE.replace("SELECT id", "SELECT security_events.id"),
        BASE + " OR severity = 'high'",
        BASE + " AND NOT severity = 'high'",
        BASE + " AND source_ip != '10.0.0.1'",
        BASE + " AND severity = 'high' OR severity = 'low'",
        BASE + " AND user_id = 999",
        BASE + " AND severity = :severity",
        BASE + " AND (severity = 'high')",
        BASE + " GROUP BY severity",
        BASE + " HAVING COUNT(*) > 1",
        BASE + " UNION SELECT id FROM security_events",
        BASE + " JOIN users ON users.id = user_id",
        BASE + " ORDER BY missing DESC",
        BASE + " ORDER BY timestamp, id",
        BASE + " ORDER BY RANDOM()",
        BASE + " ORDER BY id NULLS FIRST",
        BASE + " LIMIT 0",
        BASE + " LIMIT -1",
        BASE + " LIMIT 1.5",
        BASE + " LIMIT 10 LIMIT 20",
        BASE + " LIMIT 5 OFFSET 1",
        BASE + " AND severity IN ('high') garbage",
        BASE + " AND severity IN ('high', NULL)",
        BASE + " AND severity IN (" + ",".join("'high'" for _ in range(11)) + ")",
        BASE + " AND signature LIKE 'unterminated",
        BASE + ";",
        BASE + " -- comment",
        BASE + " /* comment */",
        BASE + " AND timestamp >= :since AND timestamp >= :since",
        BASE.replace(":user_id", ":USER_ID"),
    ],
)
def test_unsupported_sql_is_rejected_before_database(sql):
    instance = agent()
    instance.db = Mock(execute=AsyncMock())
    with pytest.raises(ValueError):
        asyncio.run(instance._execute_query(sql, {"since": "2026-11-20T00:00:00Z"}))
    instance.db.execute.assert_not_awaited()


def test_actual_rows_apply_every_supported_filter_and_never_parameter_owner():
    engine = create_engine("sqlite:///:memory:")
    SecurityEvent.__table__.create(engine)
    records = [
        (1, 123, "high", "OT ORDER BY LIMIT WHERE AND scan", "scan", "10.0.0.1"),
        (2, 123, "low", "normal", "dns", "10.0.0.2"),
        (3, 124, "high", "OT ORDER BY LIMIT WHERE AND scan", "scan", "10.0.0.1"),
        (4, 123, "critical", "O'Brien", "auth", "10.0.0.1"),
    ]
    with Session(engine) as db:
        for identifier, owner, severity, signature, category, source in records:
            db.add(
                SecurityEvent(
                    id=identifier,
                    user_id=owner,
                    timestamp=datetime(2026, 11, 20, tzinfo=UTC),
                    event_type="alert",
                    severity=severity,
                    signature=signature,
                    category=category,
                    source_ip=source,
                    protocol="TCP",
                    hostname="gateway",
                )
            )
        db.commit()
        cases = [
            (" AND severity = 'high' AND source_ip = '10.0.0.1' AND protocol = 'TCP'", {}, [1]),
            (" AND signature LIKE '%ORDER BY LIMIT WHERE AND%'", {}, [1]),
            (" AND signature LIKE '%O''Brien%'", {}, [4]),
            (" AND severity IN ('high', 'critical') AND hostname LIKE 'gate%' ORDER BY id DESC", {}, [4, 1]),
            (" AND (signature LIKE :keyword OR category LIKE :keyword)", {"keyword": "%auth%"}, [4]),
            (" AND severity = 'high' AND severity = 'low'", {}, []),
            (" AND hostname LIKE 'gate%' AND hostname LIKE 'other%'", {}, []),
            (" ORDER BY id ASC LIMIT 1", {}, [1]),
            (" ORDER BY id DESC LIMIT 500", {"keyword": "%not referenced%", "user_id": 124}, [4, 2, 1]),
        ]
        for clause, params, expected in cases:
            query = agent()._build_safe_query(BASE + clause, params)
            assert db.execute(query).scalars().all() == expected
    engine.dispose()


def test_star_and_limits_record_actual_selected_fields_and_stable_order():
    instance = agent()
    compiled = instance._compile_query(BASE.replace("SELECT id", "SELECT *") + " LIMIT 500", {})
    assert compiled.evidence == {
        "contract": "scoped_select_v1",
        "selected_columns": list(DEFAULT_HUNT_COLUMNS),
        "order_by": "timestamp",
        "direction": "DESC",
        "tie_breaker": {"column": "id", "direction": "DESC"},
        "requested_limit": 500,
        "row_limit": 100,
    }
    assert "security_events.id DESC" in str(compiled.query)
    assert instance._compile_query(BASE + " ORDER BY id", {}).evidence["tie_breaker"] is None
    assert instance._compile_query(BASE, {}).evidence["requested_limit"] is None


@pytest.mark.parametrize("params", [None, [], "bad", 1, True])
def test_run_records_invalid_params_without_querying(monkeypatch, params):
    output, instance = run_generated(monkeypatch, {"queries": [{"sql": BASE, "params": params}]})
    assert output["query_results"][0]["error"]
    instance.db.execute.assert_not_awaited()


@pytest.mark.parametrize("params", [{}, {"keyword": ""}, {"keyword": []}, {"keyword": 3}, {"keyword": "x" * 2049}])
def test_keyword_group_requires_valid_referenced_parameter(params):
    with pytest.raises(ValueError):
        agent()._build_safe_query(BASE + " AND (signature LIKE :keyword OR category LIKE :keyword)", params)


def run_generated(monkeypatch, response):
    import backend.services.agents.hunt as module

    provider = Mock(model="test")
    provider.complete_json = AsyncMock(return_value=response)
    monkeypatch.setattr(module, "get_ai_provider", lambda task: provider)
    instance = agent()
    instance.log_step = AsyncMock()
    result = Mock()
    result.keys.return_value = ["id"]
    result.fetchall.return_value = [(1,)]
    instance.db = Mock(execute=AsyncMock(return_value=result), begin_nested=MagicMock(return_value=AsyncMock()))
    return asyncio.run(instance.run(hypothesis="gateway events")), instance


@pytest.mark.parametrize("response", [[], {"queries": {}}, {"queries": "bad"}, {"queries": None}])
def test_malformed_generated_query_collection_is_recorded(monkeypatch, response):
    output, instance = run_generated(monkeypatch, response)
    assert output["error"]
    instance.db.execute.assert_not_awaited()


def test_invalid_entries_do_not_prevent_later_valid_queries(monkeypatch):
    output, instance = run_generated(monkeypatch, {"queries": [[], {"sql": {}}, {"sql": BASE + " LIMIT 500"}]})
    assert output["query_results"][0]["error"]
    assert output["query_results"][1]["error"]
    evidence = output["query_results"][2]
    assert evidence["execution"]["row_limit"] == 100
    assert evidence["execution"]["requested_limit"] == 500
    assert evidence["time_window"] == {}
    assert evidence["rows"] == [{"id": 1}]
    instance.db.execute.assert_awaited_once()


def test_fallbacks_satisfy_complete_supported_grammar():
    instance = agent()
    for query in instance._fallback_queries("scan gateway")["queries"]:
        compiled = instance._compile_query(query["sql"], query.get("params", {}))
        assert compiled.evidence["row_limit"] == 50
