"""Explicit Windows JSON preview/import preserves source identity and recorded time."""

import copy
import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from test_agent_run_detail import ledger as ledger

from backend.models.security_event import SecurityEvent
from backend.services.event_ingestion import inspect_event_record
from backend.services.event_parser_preview import preview_event_file
from backend.services.parsers.event_time import EventTimestampError
from backend.services.parsers.windows_security import parse_windows_security

STAMP = "2026-01-01T02:30:00+02:30"


def record():
    return {
        "@timestamp": STAMP,
        "agent": {"hostname": "forwarder-not-source"},
        "host": {"name": "enrichment-not-source"},
        "winlog": {
            "channel": "Security",
            "event_id": "4625",
            "computer_name": "recorded-source",
            "provider_name": "Microsoft-Windows-Security-Auditing",
            "event_data": {
                "TargetUserName": "target-account",
                "TargetDomainName": "EXAMPLE",
                "SubjectUserName": "not-target",
                "IpAddress": "192.0.2.4",
                "IpPort": "0",
            },
        },
    }


def test_windows_source_time_target_identity_and_remote_endpoint_are_not_forwarder_metadata():
    raw = record()
    parsed, reason, _ = inspect_event_record(raw, parse_windows_security)
    assert reason is None
    assert parsed["timestamp"] == datetime(2026, 1, 1, tzinfo=UTC)
    assert parsed["hostname"] == "recorded-source" and parsed["username"] == "target-account"
    assert parsed["domain"] == "EXAMPLE" and parsed["source_ip"] == "192.0.2.4" and parsed["source_port"] == 0
    assert parsed["signature_id"] == "4625" and parsed["signature"] == "Windows Security event 4625"
    assert parsed["source_type"] == parsed["event_type"] == "windows_security"
    assert parsed["severity"] == "info" and parsed.get("action") is None
    assert parsed["raw_data"]["winlog"]["event_data"]["SubjectUserName"] == "not-target"


def test_creation_time_takes_precedence_without_replacing_it_with_collector_timestamps():
    raw = record()
    raw["winlog"]["time_created"] = "2026-01-02T03:00:00Z"
    raw["@timestamp"] = "2026-01-03T00:00:00Z"
    raw["event"] = {"created": "2026-01-04T00:00:00Z", "ingested": "2026-01-05T00:00:00Z"}
    assert parse_windows_security(raw)["timestamp"] == datetime(2026, 1, 2, 3, tzinfo=UTC)


@pytest.mark.parametrize("value", [None, "", "bad", "2026-01-01T00:00:00", 0, True])
def test_invalid_present_creation_time_never_falls_back_to_an_available_timestamp(value):
    raw = record()
    raw["winlog"]["time_created"] = value
    with pytest.raises(EventTimestampError):
        parse_windows_security(raw)


def test_missing_recorded_time_never_uses_pipeline_time_or_now():
    raw = record()
    raw.pop("@timestamp")
    raw["event"] = {"created": STAMP, "ingested": STAMP}
    with pytest.raises(EventTimestampError):
        parse_windows_security(raw)


@pytest.mark.parametrize("value", [False, -1, 4294967296, "-1", "1.5", 1.5, "", None, {}, "1" * 5000])
def test_malformed_identifier_does_not_become_a_stringified_valid_event(value):
    raw = record()
    raw["winlog"]["event_id"] = value
    with pytest.raises(ValueError):
        parse_windows_security(raw)


@pytest.mark.parametrize("value", ["0", 0, "65535", "4294967295", 4294967295, "9999"])
def test_unknown_bounded_unsigned_identifiers_remain_informational_not_alerts(value):
    raw = record()
    raw["winlog"]["event_id"] = value
    data = parse_windows_security(raw)
    assert data["signature_id"] == str(int(value)) and data["severity"] == "info"
    assert data["event_type"] == "windows_security" and data.get("action") is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("IpPort", True),
        ("IpPort", -1),
        ("IpPort", "65536"),
        ("IpPort", "1.2"),
        ("IpPort", {}),
        ("IpAddress", "not-an-ip"),
        ("IpAddress", 12),
        ("TargetUserName", []),
        ("TargetDomainName", 0),
    ],
)
def test_bad_optional_types_are_skipped_without_raw_error_values(field, value):
    raw = record()
    raw["winlog"]["event_data"][field] = value
    parsed, reason, count = inspect_event_record(raw, parse_windows_security)
    assert parsed is None and reason == "parse_error" and count == 0


def test_missing_and_dash_fields_stay_absent_without_subject_or_forwarder_substitution():
    raw = record()
    raw["winlog"].pop("computer_name")
    raw["winlog"]["event_data"] = {
        "SubjectUserName": "subject-not-target",
        "TargetUserName": "-",
        "TargetDomainName": "-",
        "IpAddress": "-",
        "IpPort": "-",
    }
    parsed = parse_windows_security(raw)
    assert all(parsed[key] is None for key in ["hostname", "username", "domain", "source_ip", "source_port"])
    raw["winlog"].pop("event_data")
    assert parse_windows_security(raw)["source_ip"] is None


def test_ipv6_and_maximum_port_are_preserved_as_recorded():
    raw = record()
    raw["winlog"]["event_data"].update(IpAddress="2001:db8::7", IpPort="65535")
    assert (
        parse_windows_security(raw)["source_ip"] == "2001:db8::7"
        and parse_windows_security(raw)["source_port"] == 65535
    )


@pytest.mark.parametrize("value", [{}, {"winlog": {}}, {"winlog": {"channel": "System"}}, {"winlog": "<xml>"}])
def test_other_log_channels_and_non_winlogbeat_shapes_are_not_silently_accepted(value):
    assert parse_windows_security(value) is None


def test_eventlog_provider_security_channel_is_supported_not_only_auditing_provider():
    raw = record()
    raw["winlog"].update(provider_name="Microsoft-Windows-Eventlog", event_id="1100")
    assert parse_windows_security(raw)["signature_id"] == "1100"


def test_authentication_preview_and_actual_owned_import_have_identical_counts(ledger):
    valid = record()
    valid["winlog"]["event_data"]["note"] = "private-person@example.test"
    bad_time = copy.deepcopy(valid)
    bad_time.pop("@timestamp")
    bad_field = copy.deepcopy(valid)
    bad_field["winlog"]["event_data"]["IpPort"] = True
    wrong_channel = copy.deepcopy(valid)
    wrong_channel["winlog"]["channel"] = "Application"
    body = json.dumps([valid, bad_time, bad_field, wrong_channel]).encode()
    preview = ledger[0].post(
        "/api/v1/events/upload/preview",
        params={"source_type": "windows_security"},
        files={"file": ("windows.ndjson", body)},
    )
    assert preview.status_code == 200, preview.text
    data = preview.json()["data"]
    assert data["accepted"] == 1 and data["received"] == 4 and data["skipped"] == 3
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "parse_error": 1, "unsupported_record": 1}
    assert "private-person" not in preview.text and "target-account" not in preview.text
    imported = ledger[0].post(
        "/api/v1/events/upload",
        params={"source_type": "windows_security", "preview_fingerprint": data["fingerprint"]},
        files={"file": ("windows.ndjson", body)},
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
        assert saved.user_id == ledger[1].id and saved.source_type == "windows_security"
        assert saved.timestamp.replace(tzinfo=UTC) == datetime(2026, 1, 1, tzinfo=UTC)
        assert saved.raw_data["winlog"]["event_data"]["note"] == "[REDACTED_EMAIL]"


def test_metadata_preview_contains_neither_raw_payload_nor_invented_success_action():
    data = preview_event_file(json.dumps([record()]).encode(), "windows_security")
    assert data["accepted"] == 1 and "raw_data" not in data and "action" not in data


def test_empty_optional_values_remain_absent_rather_than_invented_or_stringified():
    raw = record()
    raw["winlog"]["computer_name"] = ""
    raw["winlog"]["event_data"] = {"TargetUserName": "", "TargetDomainName": "", "IpAddress": "", "IpPort": ""}
    parsed = parse_windows_security(raw)
    assert all(parsed[key] is None for key in ["hostname", "username", "domain", "source_ip", "source_port"])
