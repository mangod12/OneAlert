"""Tests for semantic search and blast radius."""

import pytest
from backend.services.semantic_search import (
    _tokenize, _compute_tf, _compute_idf, _tfidf_vector,
    _cosine_similarity, _case_to_text,
)


class TestTokenizer:
    """Test text tokenization."""

    def test_basic_tokenization(self):
        tokens = _tokenize("Hello World test")
        assert "hello" in tokens
        assert "world" in tokens
        assert "test" in tokens

    def test_removes_stopwords(self):
        tokens = _tokenize("the quick brown fox is a test")
        assert "the" not in tokens
        assert "is" not in tokens
        assert "a" not in tokens
        assert "quick" in tokens
        assert "brown" in tokens

    def test_removes_short_tokens(self):
        tokens = _tokenize("I am a big test")
        assert "i" not in tokens  # single char removed

    def test_handles_special_characters(self):
        tokens = _tokenize("alert-192.168.1.1:modbus/tcp")
        assert "alert" in tokens
        assert "192" in tokens
        assert "modbus" in tokens
        assert "tcp" in tokens

    def test_empty_string(self):
        assert _tokenize("") == []


class TestTFIDF:
    """Test TF-IDF computation."""

    def test_term_frequency(self):
        tokens = ["hello", "world", "hello"]
        tf = _compute_tf(tokens)
        assert abs(tf["hello"] - 2/3) < 0.001
        assert abs(tf["world"] - 1/3) < 0.001

    def test_empty_tf(self):
        assert _compute_tf([]) == {}

    def test_idf_computation(self):
        docs = [["hello", "world"], ["hello", "test"], ["world", "test"]]
        idf = _compute_idf(docs)
        # "hello" appears in 2/3 docs
        # "test" appears in 2/3 docs
        # "world" appears in 2/3 docs
        assert idf["hello"] == idf["test"] == idf["world"]

    def test_idf_rare_term_higher(self):
        docs = [["rare", "common"], ["common", "other"], ["common", "another"]]
        idf = _compute_idf(docs)
        assert idf["rare"] > idf["common"]

    def test_tfidf_vector(self):
        tokens = ["attack", "lateral", "movement"]
        idf = {"attack": 1.0, "lateral": 2.0, "movement": 1.5}
        vec = _tfidf_vector(tokens, idf)
        assert len(vec) == 3
        assert vec["lateral"] > vec["attack"]  # Higher IDF = higher weight


class TestCosineSimilarity:
    """Test cosine similarity."""

    def test_identical_vectors(self):
        vec = {"a": 1.0, "b": 2.0, "c": 3.0}
        assert abs(_cosine_similarity(vec, vec) - 1.0) < 0.001

    def test_orthogonal_vectors(self):
        vec_a = {"a": 1.0, "b": 0.0}
        vec_b = {"c": 1.0, "d": 0.0}
        assert _cosine_similarity(vec_a, vec_b) == 0.0

    def test_partial_overlap(self):
        vec_a = {"attack": 1.0, "lateral": 1.0, "movement": 1.0}
        vec_b = {"attack": 1.0, "brute": 1.0, "force": 1.0}
        sim = _cosine_similarity(vec_a, vec_b)
        assert 0 < sim < 1

    def test_empty_vectors(self):
        assert _cosine_similarity({}, {"a": 1.0}) == 0.0
        assert _cosine_similarity({"a": 1.0}, {}) == 0.0
        assert _cosine_similarity({}, {}) == 0.0


class TestCaseToText:
    """Test case serialization for search."""

    def test_case_to_text(self):
        from unittest.mock import MagicMock
        case = MagicMock()
        case.title = "VPN Compromise"
        case.summary = "Attacker gained access via VPN"
        case.attack_narrative = "Lateral movement detected"
        case.mitre_tactics = ["initial-access", "lateral-movement"]
        case.mitre_techniques = ["T1078", "T1021"]
        case.severity = "critical"

        text = _case_to_text(case)
        assert "VPN Compromise" in text
        assert "lateral" in text.lower()
        assert "T1078" in text
        assert "critical" in text

    def test_case_with_none_fields(self):
        from unittest.mock import MagicMock
        case = MagicMock()
        case.title = "Test"
        case.summary = None
        case.attack_narrative = None
        case.mitre_tactics = None
        case.mitre_techniques = None
        case.severity = None

        text = _case_to_text(case)
        assert "Test" in text
