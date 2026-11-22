"""Journal JSON preserves recorded time and never infers auth facts from text."""

import copy
import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from test_agent_run_detail import ledger as ledger

from backend.models.security_event import EventSource, SecurityEvent
from backend.services.event_ingestion import inspect_event_record
from backend.services.event_parser_preview import preview_event_file
from backend.services.parsers.event_time import EventTimestampError
from backend.services.parsers.linux_journal import parse_linux_journal


def record():
    return {
        "_SOURCE_REALTIME_TIMESTAMP": "1767225600000001",
        "__REALTIME_TIMESTAMP": "1767225600000123",
        "_HOSTNAME": "source-host",
        "_SYSTEMD_UNIT": "ssh.service",
        "MESSAGE": "Failed password for sample-account from 192.0.2.4 port 22",
        "_UID": "0",
        "_AUDIT_LOGINUID": "1000",
        "PRIORITY": "0",
        "host": {"name": "not-source"},
    }


def test_precise_source_time_and_host_without_message_derived_auth_or_process_identity():
    raw = record()
    parsed, reason, count = inspect_event_record(raw, parse_linux_journal)
    assert reason is None and count == 2  # Existing redaction also matches the two 16-digit raw time strings.
    assert parsed["timestamp"] == datetime(2026, 1, 1, microsecond=1, tzinfo=UTC)
    assert parsed["hostname"] == "source-host" and parsed["signature"] == "Linux journal: ssh.service"
    assert parsed["severity"] == "info" and parsed["source_type"] == parsed["event_type"] == "linux_journal"
    assert all(parsed.get(key) is None for key in ["username", "source_ip", "source_port", "action", "signature_id"])
    assert parsed["raw_data"]["MESSAGE"] == raw["MESSAGE"]
    assert parsed["raw_data"]["_SOURCE_REALTIME_TIMESTAMP"] == "[REDACTED_CC]"
    assert parsed["raw_data"]["__REALTIME_TIMESTAMP"] == "[REDACTED_CC]"


def test_missing_source_time_uses_recorded_journal_reception_time_with_microsecond_precision():
    raw = record()
    raw.pop("_SOURCE_REALTIME_TIMESTAMP")
    assert parse_linux_journal(raw)["timestamp"] == datetime(2026, 1, 1, microsecond=123, tzinfo=UTC)


@pytest.mark.parametrize(
    "value",
    [
        None,
        True,
        0,
        1767225600000001,
        1.5,
        "",
        "-1",
        "1.5",
        "1e6",
        " 1",
        "2026-01-01T00:00:00Z",
        [],
        {},
        "1" * 5000,
        "999999999999999999",
    ],
)
def test_invalid_present_source_time_cannot_fall_back_to_valid_journal_reception_time(value):
    raw = record()
    raw["_SOURCE_REALTIME_TIMESTAMP"] = value
    with pytest.raises(EventTimestampError):
        parse_linux_journal(raw)


def test_no_realtime_clock_never_uses_monotonic_syslog_iso_or_now():
    raw = record()
    raw.pop("_SOURCE_REALTIME_TIMESTAMP")
    raw.pop("__REALTIME_TIMESTAMP")
    raw.update(
        __MONOTONIC_TIMESTAMP="1767225600000001", SYSLOG_TIMESTAMP="Jan 1 00:00:00", timestamp="2026-01-01T00:00:00Z"
    )
    assert inspect_event_record(raw, parse_linux_journal)[1] == "invalid_timestamp"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("0", datetime(1970, 1, 1, tzinfo=UTC)),
        ("1", datetime(1970, 1, 1, microsecond=1, tzinfo=UTC)),
        ("253402300799999999", datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)),
    ],
)
def test_exact_microseconds_at_supported_boundaries(text, expected):
    raw = record()
    raw["_SOURCE_REALTIME_TIMESTAMP"] = text
    assert parse_linux_journal(raw)["timestamp"] == expected


@pytest.mark.parametrize(
    "key,value",
    [
        ("MESSAGE", None),
        ("MESSAGE", []),
        ("MESSAGE", [65, 66]),
        ("MESSAGE", ["one", "two"]),
        ("MESSAGE", ""),
        ("MESSAGE", "  "),
        ("MESSAGE", {}),
        ("_HOSTNAME", ["one", "two"]),
        ("_HOSTNAME", None),
        ("_SYSTEMD_UNIT", []),
        ("_SYSTEMD_UNIT", ""),
        ("_SYSTEMD_UNIT", 0),
    ],
)
def test_null_binary_multivalued_or_invalid_used_fields_are_not_stringified_or_substituted(key, value):
    raw = record()
    raw[key] = value
    assert inspect_event_record(raw, parse_linux_journal)[1] == "parse_error"


def test_missing_optional_host_and_unit_do_not_borrow_process_forwarder_or_client_labels():
    raw = record()
    raw.pop("_HOSTNAME")
    raw.pop("_SYSTEMD_UNIT")
    raw.update(SYSLOG_IDENTIFIER="sshd", _COMM="sshd", _EXE="/usr/sbin/sshd")
    parsed = parse_linux_journal(raw)
    assert parsed["hostname"] is None and parsed["signature"] == "Linux journal entry"
    assert parsed.get("username") is None and parsed.get("source_ip") is None


def test_other_json_shape_is_unsupported_and_raw_binary_is_not_a_supported_message():
    assert parse_linux_journal({"winlog": {"channel": "Security"}}) is None
    assert inspect_event_record("not a journal object", parse_linux_journal)[1] == "invalid_record"


def test_preview_metadata_does_not_disclose_message_or_host_and_redacts_only_accepted_payload():
    raw = record()
    raw["MESSAGE"] = "Synthetic note for private-person@example.test"
    text = json.dumps(preview_event_file(json.dumps([raw]).encode(), "linux_journal"))
    data = json.loads(text)
    assert data["accepted"] == 1 and data["redactions_in_accepted"] == 3
    assert "private-person" not in text and "source-host" not in text and "MESSAGE" not in text
    assert "raw_data" not in data


def test_preview_is_authenticated_and_bound_import_matches_counts_without_creating_sources_before_import(ledger):
    client, owner = ledger[0], ledger[1]
    raw = record()
    raw["MESSAGE"] = "Synthetic note for private-person@example.test"
    invalid_time = copy.deepcopy(raw)
    invalid_time["_SOURCE_REALTIME_TIMESTAMP"] = "bad"
    invalid_message = copy.deepcopy(raw)
    invalid_message["MESSAGE"] = [65, 66]
    body = json.dumps([raw, invalid_time, invalid_message, {"unrelated": True}]).encode()
    params = {"source_type": "linux_journal"}
    preview = client.post("/api/v1/events/upload/preview", params=params, files={"file": ("journal.ndjson", body)})
    assert preview.status_code == 200, preview.text
    data = preview.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (4, 1, 3)
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "parse_error": 1, "unsupported_record": 1}
    assert "private-person" not in preview.text and "source-host" not in preview.text
    with ledger[-1]() as db:
        assert db.execute(select(SecurityEvent)).scalars().all() == []
        assert db.execute(select(EventSource)).scalars().all() == []
    rejected = client.post(
        "/api/v1/events/upload",
        params={**params, "preview_fingerprint": data["fingerprint"]},
        files={"file": ("journal.ndjson", body + b" ")},
    )
    assert rejected.status_code == 409
    imported = client.post(
        "/api/v1/events/upload",
        params={**params, "preview_fingerprint": data["fingerprint"]},
        files={"file": ("journal.ndjson", body)},
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["received"], result["ingested"], result["skipped"], result["redacted"], result["skip_reasons"]) == (
        data["received"],
        data["accepted"],
        data["skipped"],
        data["redactions_in_accepted"],
        data["skip_reasons"],
    )
    with ledger[-1]() as db:
        saved = db.execute(select(SecurityEvent)).scalar_one()
        assert saved.user_id == owner.id and saved.source_type == "linux_journal"
        assert saved.timestamp.replace(tzinfo=UTC) == datetime(2026, 1, 1, microsecond=1, tzinfo=UTC)
        assert saved.raw_data["MESSAGE"] == "Synthetic note for [REDACTED_EMAIL]"
        assert saved.severity == "info" and saved.username is None and saved.source_ip is None
