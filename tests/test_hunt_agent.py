"""Tests for Hunt Agent — query safety validation and fallback logic."""
import pytest
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
