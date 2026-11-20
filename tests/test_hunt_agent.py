"""Tests for Hunt Agent — query safety validation and fallback logic."""
import pytest
import backend.main  # noqa: F401 - register related models for isolated ORM query tests
from backend.services.agents.hunt import HuntAgent


class TestQuerySafety:
    def _agent(self):
        return HuntAgent.__new__(HuntAgent)

    def test_valid_select_passes(self):
        a = self._agent()
        assert a._is_safe_query("SELECT * FROM security_events WHERE user_id = :user_id") is True

    def test_insert_rejected(self):
        a = self._agent()
        assert a._is_safe_query("INSERT INTO security_events VALUES (1) WHERE user_id = :user_id") is False

    def test_delete_rejected(self):
        a = self._agent()
        assert a._is_safe_query("DELETE FROM security_events WHERE user_id = :user_id") is False

    def test_drop_rejected(self):
        a = self._agent()
        assert a._is_safe_query("DROP TABLE security_events") is False

    def test_no_user_id_rejected(self):
        a = self._agent()
        assert a._is_safe_query("SELECT * FROM security_events") is False

    def test_update_rejected(self):
        a = self._agent()
        assert a._is_safe_query("UPDATE security_events SET severity='low' WHERE user_id = :user_id") is False

    def test_mixed_case_passes(self):
        a = self._agent()
        assert a._is_safe_query("select id from security_events where user_id = :user_id") is True

    def test_multiple_statements_rejected(self):
        a = self._agent()
        assert a._is_safe_query(
            "SELECT * FROM security_events WHERE user_id = :user_id; DROP TABLE users"
        ) is False

    def test_comments_rejected(self):
        a = self._agent()
        assert a._is_safe_query(
            "SELECT * FROM security_events WHERE user_id = :user_id -- bypass"
        ) is False

    def test_other_table_rejected(self):
        a = self._agent()
        assert a._is_safe_query("SELECT * FROM users WHERE user_id = :user_id") is False

    def test_unparameterized_user_scope_rejected(self):
        a = self._agent()
        assert a._is_safe_query("SELECT * FROM security_events WHERE user_id = 1") is False


class TestFallbackQueries:
    def test_fallback_generates_queries(self):
        a = HuntAgent.__new__(HuntAgent)
        result = a._fallback_queries("port scan from 10.0.0.5")
        assert len(result["queries"]) == 2
        assert result["queries"][0]["params"]["keyword"] == "%port%"
        assert ":keyword" in result["queries"][0]["sql"]

    def test_fallback_empty_hypothesis(self):
        a = HuntAgent.__new__(HuntAgent)
        result = a._fallback_queries("")
        assert len(result["queries"]) == 2


class TestSafeQueryBuilder:
    def _agent(self):
        agent = HuntAgent.__new__(HuntAgent)
        agent.user_id = 123
        return agent

    def test_safe_query_builder_applies_limit_cap(self):
        a = self._agent()
        query = a._build_safe_query(
            "SELECT id, severity FROM security_events WHERE user_id = :user_id "
            "AND severity = 'high' ORDER BY timestamp DESC LIMIT 500",
            {},
        )
        compiled = str(query.compile(compile_kwargs={"literal_binds": True}))
        assert "security_events.user_id = 123" in compiled
        assert "security_events.severity = 'high'" in compiled
        assert "LIMIT 100" in compiled

    def test_safe_query_builder_applies_keyword_param(self):
        a = self._agent()
        query = a._build_safe_query(
            "SELECT id FROM security_events WHERE user_id = :user_id "
            "AND (signature LIKE :keyword OR category LIKE :keyword)",
            {"keyword": "%scan%"},
        )
        compiled = str(query.compile(compile_kwargs={"literal_binds": True}))
        assert "security_events.signature LIKE '%scan%'" in compiled
        assert "security_events.category LIKE '%scan%'" in compiled


class TestHuntTimeBounds:
    def _agent(self):
        agent = HuntAgent.__new__(HuntAgent)
        agent.user_id = 123
        return agent

    def test_normalizes_aware_bounds_and_keeps_exact_inclusive_exclusive_operators(self):
        sql = ('SELECT id FROM security_events WHERE user_id = :user_id '
               'AND timestamp >= :since AND timestamp < :before ORDER BY timestamp DESC')
        agent = self._agent()
        params = {'since': '2026-11-20T10:30:00+05:30', 'before': '2026-11-20T06:00:00Z'}
        bounds = agent._timestamp_bounds(sql, params)
        assert bounds['since'].isoformat() == '2026-11-20T05:00:00+00:00'
        compiled = str(agent._build_safe_query(sql, params).compile(compile_kwargs={'literal_binds': True}))
        assert "timestamp >= '2026-11-20 05:00:00+00:00'" in compiled
        assert "timestamp < '2026-11-20 06:00:00+00:00'" in compiled
        assert 'security_events.user_id = 123' in compiled

    @pytest.mark.parametrize('params', [{}, {'since': None}, {'since': 7}, {'since': '2026-11-20'},
                                      {'since': '2026-11-20T05:00:00'}, {'since': 'not-a-date'}])
    def test_rejects_missing_invalid_or_naive_bound_instead_of_widening(self, params):
        with pytest.raises(ValueError):
            self._agent()._build_safe_query('SELECT id FROM security_events WHERE user_id = :user_id AND timestamp >= :since', params)

    @pytest.mark.parametrize('predicate', [
        "timestamp >= '2026-11-20'", "timestamp > :since", "timestamp <= :before",
        "timestamp BETWEEN :since AND :before", "DATE(timestamp) = '2026-11-20'",
        '(timestamp >= :since) = FALSE', 'NOT (timestamp >= :since)', 'NOT timestamp >= :since', 'timestamp >= :since OR severity = \'high\'',
        'timestamp >= :since + interval \'1 hour\'', 'timestamp >= :since AND timestamp >= :since',
    ])
    def test_rejects_unsupported_time_expressions(self, predicate):
        with pytest.raises(ValueError):
            self._agent()._build_safe_query('SELECT id FROM security_events WHERE user_id = :user_id AND ' + predicate,
                                           {'since': '2026-11-20T05:00:00Z', 'before': '2026-11-20T06:00:00Z'})

    @pytest.mark.parametrize('end', ['2026-11-20T05:00:00Z', '2026-11-20T04:00:00Z'])
    def test_rejects_empty_or_reversed_window(self, end):
        with pytest.raises(ValueError, match='earlier'):
            self._agent()._build_safe_query('SELECT id FROM security_events WHERE user_id = :user_id AND timestamp >= :since AND timestamp < :before',
                                           {'since': '2026-11-20T05:00:00Z', 'before': end})

    def test_fallback_last_24_hours_has_an_actual_aware_cutoff(self):
        from datetime import UTC, datetime, timedelta
        agent = self._agent()
        before = datetime.now(UTC) - timedelta(hours=24)
        fallback = agent._fallback_queries('port scan')['queries'][1]
        after = datetime.now(UTC) - timedelta(hours=24)
        assert 'timestamp >= :since' in fallback['sql']
        bound = agent._timestamp_bounds(fallback['sql'], fallback['params'])['since']
        assert before <= bound <= after
        compiled = str(agent._build_safe_query(fallback['sql'], fallback['params']))
        assert 'security_events.timestamp >=' in compiled

    def test_actual_rows_respect_boundaries_and_owner_scope(self):
        from datetime import UTC, datetime, timedelta
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from backend.models.security_event import SecurityEvent
        engine = create_engine('sqlite:///:memory:')
        SecurityEvent.__table__.create(engine)
        start = datetime(2026, 11, 20, 5, tzinfo=UTC)
        with Session(engine) as db:
            for record_id, owner, timestamp in [(1,123,start-timedelta(seconds=1)), (2,123,start),
                                                (3,123,start+timedelta(minutes=59)), (4,123,start+timedelta(hours=1)), (5,124,start)]:
                db.add(SecurityEvent(id=record_id, user_id=owner, timestamp=timestamp, event_type='alert'))
            db.commit()
            query = self._agent()._build_safe_query('SELECT id FROM security_events WHERE user_id = :user_id AND timestamp >= :since AND timestamp < :before',
                                                   {'since': start.isoformat(), 'before': (start+timedelta(hours=1)).isoformat()})
            assert set(db.execute(query).scalars().all()) == {2,3}
        engine.dispose()


@pytest.mark.parametrize('valid', [True, False])
def test_hunt_run_records_applied_bounds_and_rejects_unsupported_time_before_db(monkeypatch, valid):
    import asyncio
    from unittest.mock import AsyncMock, Mock
    import backend.services.agents.hunt as module
    sql = 'SELECT id FROM security_events WHERE user_id = :user_id AND timestamp ' + ('>= :since' if valid else ">= '2026-11-20'")
    provider = Mock(model='test-model')
    provider.complete_json = AsyncMock(return_value={'queries': [{'sql': sql, 'params': {'since': '2026-11-20T10:30:00+05:30'}}]})
    monkeypatch.setattr(module, 'get_ai_provider', lambda task: provider)
    agent = HuntAgent.__new__(HuntAgent)
    agent.user_id = 123
    agent.log_step = AsyncMock()
    result = Mock()
    result.keys.return_value = ['id']
    result.fetchall.return_value = [(1,)]
    agent.db = Mock(execute=AsyncMock(return_value=result))
    output = asyncio.run(agent.run(hypothesis='events since morning'))['query_results'][0]
    if valid:
        assert output['time_window'] == {'since': '2026-11-20T05:00:00+00:00'}
        assert output['rows'] == [{'id': 1}]
        assert agent.db.execute.await_count == 1
    else:
        assert 'Unsupported time predicate' in output['error']
        assert output['rows'] == []
        agent.db.execute.assert_not_awaited()
    prompt = provider.complete_json.call_args.args[0][1].content
    assert 'Current UTC time:' in prompt


def test_sql_words_inside_literal_text_do_not_hide_time_filters():
    agent = HuntAgent.__new__(HuntAgent)
    sql = ("SELECT id FROM security_events WHERE user_id = :user_id "
           "AND signature LIKE '%ORDER BY LIMIT WHERE OR NOT timestamp%' AND timestamp >= :since")
    bounds = agent._timestamp_bounds(sql, {'since': '2026-11-20T05:00:00Z'})
    assert bounds['since'].isoformat() == '2026-11-20T05:00:00+00:00'
