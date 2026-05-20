"""Tests for PII/secret redaction pipeline."""

import pytest
from backend.services.pii_redactor import redact_string, redact_dict, redact_event_for_llm


class TestRedactString:
    """Test string-level redaction."""

    def test_redact_email(self):
        text = "User john.doe@example.com logged in"
        result, count = redact_string(text)
        assert "[REDACTED_EMAIL]" in result
        assert "john.doe@example.com" not in result
        assert count >= 1

    def test_redact_ssn(self):
        text = "SSN: 123-45-6789"
        result, count = redact_string(text)
        assert "[REDACTED_SSN]" in result
        assert "123-45-6789" not in result
        assert count >= 1

    def test_redact_api_key(self):
        # Use a clearly fake key pattern (not a real Stripe format)
        text = "Authorization: sk_test_fakekey1234567890abcdef"
        result, count = redact_string(text)
        assert "[REDACTED_API_KEY]" in result
        assert count >= 1

    def test_redact_bearer_token(self):
        text = "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature"
        result, count = redact_string(text)
        assert "eyJhbGciOiJ" not in result
        assert count >= 1

    def test_redact_password_field(self):
        text = "password=supersecret123"
        result, count = redact_string(text)
        assert "supersecret123" not in result
        assert count >= 1

    def test_redact_credential_field(self):
        text = "credential: my-api-secret-key"
        result, count = redact_string(text)
        assert "my-api-secret-key" not in result
        assert count >= 1

    def test_redact_jwt(self):
        text = "token eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.dGVzdHNpZ25hdHVyZQ"
        result, count = redact_string(text)
        assert "[REDACTED_JWT]" in result
        assert count >= 1

    def test_no_redaction_needed(self):
        text = "Normal log message with IP 10.0.0.1"
        result, count = redact_string(text)
        assert result == text
        assert count == 0

    def test_multiple_patterns(self):
        text = "User admin@corp.com set password=hunter2"
        result, count = redact_string(text)
        assert "admin@corp.com" not in result
        assert "hunter2" not in result
        assert count >= 2


class TestRedactDict:
    """Test dictionary-level redaction."""

    def test_preserves_network_fields(self):
        data = {
            "source_ip": "10.0.0.1",
            "dest_ip": "192.168.1.100",
            "hostname": "plc-01.ot.local",
            "domain": "malware-c2.evil.com",
            "protocol": "modbus",
            "user_field": "john@example.com",
        }
        result, count = redact_dict(data)
        assert result["source_ip"] == "10.0.0.1"
        assert result["dest_ip"] == "192.168.1.100"
        assert result["hostname"] == "plc-01.ot.local"
        assert result["domain"] == "malware-c2.evil.com"
        assert result["protocol"] == "modbus"
        assert "john@example.com" not in result["user_field"]
        assert count >= 1

    def test_nested_dict_redaction(self):
        data = {
            "event": {
                "user": "admin@corp.com",
                "source_ip": "10.0.0.5",
            }
        }
        result, count = redact_dict(data)
        assert "admin@corp.com" not in str(result)
        assert result["event"]["source_ip"] == "10.0.0.5"

    def test_list_redaction(self):
        data = {
            "users": ["alice@example.com", "bob@example.com"],
            "severity": "high",
        }
        result, count = redact_dict(data)
        assert "alice@example.com" not in str(result)
        assert "bob@example.com" not in str(result)
        assert result["severity"] == "high"

    def test_non_string_values_preserved(self):
        data = {"count": 42, "active": True, "ratio": 3.14, "tags": None}
        result, count = redact_dict(data)
        assert result == data
        assert count == 0


class TestRedactEventForLLM:
    """Test full event redaction for LLM processing."""

    def test_adds_redaction_count(self):
        event = {
            "source_ip": "10.0.0.1",
            "raw_payload": "password=secret123",
        }
        result = redact_event_for_llm(event)
        assert "_redaction_count" in result
        assert result["_redaction_count"] > 0

    def test_no_count_when_clean(self):
        event = {
            "source_ip": "10.0.0.1",
            "event_type": "connection",
            "severity": "low",
        }
        result = redact_event_for_llm(event)
        assert "_redaction_count" not in result

    def test_realistic_suricata_event(self):
        event = {
            "timestamp": "2026-05-20T10:00:00Z",
            "event_type": "alert",
            "source_ip": "10.0.50.100",
            "dest_ip": "192.168.1.10",
            "alert": {
                "signature": "ET MALWARE CnC Beacon",
                "category": "Malware Command and Control",
            },
            "http": {
                "url": "/api/exfil",
                "http_user_agent": "Mozilla/5.0",
                "cookie": "session=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.dGVzdHNpZ25hdHVyZQ",
            },
        }
        result = redact_event_for_llm(event)
        # Network observables preserved
        assert result["source_ip"] == "10.0.50.100"
        assert result["dest_ip"] == "192.168.1.10"
        # JWT in cookie redacted
        assert "eyJhbGciOiJ" not in str(result)
