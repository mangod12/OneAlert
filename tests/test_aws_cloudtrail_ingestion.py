"""Explicit CloudTrail import keeps caller, target, time and API labels separate."""

import copy
import json
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from test_agent_run_detail import ledger as ledger

from backend.models.security_event import EventSource, SecurityEvent
from backend.services.event_ingestion import inspect_event_record
from backend.services.event_parser_preview import preview_event_file
from backend.services.event_upload import parse_event_upload
from backend.services.parsers.aws_cloudtrail import parse_aws_cloudtrail


def record():
    return {
        "eventVersion": "1.11",
        "eventTime": "2026-01-01T00:00:00Z",
        "eventSource": "iam.amazonaws.com",
        "eventName": "DeleteUser",
        "userIdentity": {
            "type": "IAMUser",
            "userName": "recorded-caller",
            "arn": "arn:aws:iam::111122223333:user/not-a-substitute",
            "sessionContext": {"sessionIssuer": {"userName": "not-the-caller"}},
        },
        "sourceIPAddress": "192.0.2.10",
        "requestParameters": {"userName": "different-target", "note": "private-person@example.test"},
        "errorCode": "AccessDenied",
        "readOnly": False,
    }


def test_recorded_caller_and_address_are_not_request_target_or_execution_verdict():
    raw = record()
    before = copy.deepcopy(raw)
    parsed, reason, count = inspect_event_record(raw, parse_aws_cloudtrail)
    assert reason is None and count == 1 and raw == before
    assert parsed["timestamp"] == datetime(2026, 1, 1, tzinfo=UTC)
    assert parsed["source_type"] == parsed["event_type"] == "aws_cloudtrail"
    assert parsed["signature"] == "CloudTrail: iam.amazonaws.com / DeleteUser"
    assert parsed["username"] == "recorded-caller" and parsed["source_ip"] == "192.0.2.10"
    assert parsed["severity"] == "info"
    assert all(parsed.get(key) is None for key in ["hostname", "dest_ip", "action", "signature_id", "source_port"])
    assert parsed["raw_data"]["requestParameters"]["note"] == "[REDACTED_EMAIL]"
    assert parsed["raw_data"]["errorCode"] == "AccessDenied"


@pytest.mark.parametrize(
    "value", ["2001:db8::1", "192.0.2.1", "AWS Internal/123", "s3.amazonaws.com", "999.0.0.1", "fe80::1%eth0", None]
)
def test_only_literal_recorded_ip_endpoints_are_normalized(value):
    raw = record()
    raw["sourceIPAddress"] = value
    assert parse_aws_cloudtrail(raw)["source_ip"] == (value if value in {"2001:db8::1", "192.0.2.1"} else None)


def test_absent_caller_never_borrows_role_issuer_arn_or_request_target():
    raw = record()
    raw["userIdentity"].pop("userName")
    parsed = parse_aws_cloudtrail(raw)
    assert parsed["username"] is None and parsed.get("domain") is None
    raw.pop("sourceIPAddress")
    assert parse_aws_cloudtrail(raw)["source_ip"] is None


@pytest.mark.parametrize(
    "value", [None, "", "bad", "2026-01-01T00:00:00", 1767225600, True, {}, [], "2026-02-30T00:00:00Z"]
)
def test_invalid_recorded_time_never_uses_other_timestamp_or_now(value):
    raw = record()
    raw["eventTime"] = value
    raw["timestamp"] = "2026-01-01T00:00:00Z"
    assert inspect_event_record(raw, parse_aws_cloudtrail)[1] == "invalid_timestamp"


def test_aware_time_normalizes_offset_without_clock_fallback():
    raw = record()
    raw["eventTime"] = "2026-01-01T05:30:00.123456+05:30"
    assert parse_aws_cloudtrail(raw)["timestamp"] == datetime(2026, 1, 1, microsecond=123456, tzinfo=UTC)
    raw.pop("eventTime")
    assert inspect_event_record(raw, parse_aws_cloudtrail)[1] == "invalid_timestamp"


@pytest.mark.parametrize("value", [None, True, 1.11, "2.0", "1", "1.", "1.1e2", " 1.11", "1." + "1" * 20])
def test_unrecognized_or_incompatible_format_is_not_guessed(value):
    raw = record()
    raw["eventVersion"] = value
    assert parse_aws_cloudtrail(raw) is None


@pytest.mark.parametrize("version", ["1.0", "1.08", "1.11", "1.123"])
def test_backward_compatible_major_one_minor_versions_are_not_float_compared(version):
    raw = record()
    raw["eventVersion"] = version
    assert parse_aws_cloudtrail(raw)["source_type"] == "aws_cloudtrail"


@pytest.mark.parametrize(
    "field,value",
    [
        ("eventName", None),
        ("eventSource", ""),
        ("eventName", []),
        ("eventSource", {}),
        ("sourceIPAddress", True),
        ("sourceIPAddress", []),
        ("userIdentity", []),
        ("userIdentity", None),
    ],
)
def test_used_fields_are_not_stringified_or_substituted(field, value):
    raw = record()
    raw[field] = value
    assert inspect_event_record(raw, parse_aws_cloudtrail)[1] == "parse_error"


@pytest.mark.parametrize("value", [[], {}, True, "", "  "])
def test_invalid_direct_caller_names_are_not_inferred(value):
    raw = record()
    raw["userIdentity"]["userName"] = value
    assert inspect_event_record(raw, parse_aws_cloudtrail)[1] == "parse_error"


@pytest.mark.parametrize("shape", ["object", "array", "ndjson", "envelope"])
def test_supported_file_shapes_share_identical_parser_preview_counts(shape):
    raw = record()
    body = (
        json.dumps(raw)
        if shape == "object"
        else json.dumps([raw])
        if shape == "array"
        else json.dumps(raw) + "\n"
        if shape == "ndjson"
        else json.dumps({"Records": [raw]})
    )
    data = preview_event_file(body.encode(), "aws_cloudtrail")
    assert (data["received"], data["accepted"], data["skipped"], data["redactions_in_accepted"]) == (1, 1, 0, 1)
    assert "private-person" not in json.dumps(data) and "recorded-caller" not in json.dumps(data)
    assert "requestParameters" not in json.dumps(data)


def test_cloudtrail_envelope_is_only_unwrapped_for_explicit_parser_and_not_recursive():
    raw = record()
    body = json.dumps({"Records": [raw]}).encode()
    assert parse_event_upload(body) == [{"Records": [raw]}]
    assert parse_event_upload(body, "linux_journal") == [{"Records": [raw]}]
    assert parse_event_upload(body, "aws_cloudtrail") == [raw]
    assert preview_event_file(body, "linux_journal")["accepted"] == 0
    assert preview_event_file(json.dumps({"Records": [{"Records": [raw]}]}).encode(), "aws_cloudtrail")["accepted"] == 0


@pytest.mark.parametrize(
    "envelope",
    [
        {"Records": []},
        {"Records": None},
        {"Records": {}},
        {"Records": [None]},
        {"Records": [{}], "unexpected": "private"},
        {"Records": [{}] * 50001},
    ],
)
def test_invalid_or_ambiguous_envelope_is_rejected_before_ingestion(envelope):
    with pytest.raises(HTTPException):
        parse_event_upload(json.dumps(envelope).encode(), "aws_cloudtrail")


def test_duplicate_keys_and_nonstandard_numbers_in_envelope_are_not_silently_replaced():
    for body in [b'{"Records":[],"Records":[{}]}', b'{"Records":[{"x":NaN}]}']:
        with pytest.raises(HTTPException):
            parse_event_upload(body, "aws_cloudtrail")


def test_preview_and_bound_import_share_unwrapped_counts_and_owned_storage(ledger):
    client, owner = ledger[0], ledger[1]
    raw = record()
    bad = copy.deepcopy(raw)
    bad["eventTime"] = "bad"
    body = json.dumps({"Records": [raw, bad, {"not_cloudtrail": True}]}).encode()
    params = {"source_type": "aws_cloudtrail"}
    response = client.post("/api/v1/events/upload/preview", params=params, files={"file": ("cloudtrail.json", body)})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (3, 1, 2)
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "unsupported_record": 1}
    assert data["skipped_positions"]["invalid_timestamp"]["record_positions"] == [2]
    with ledger[-1]() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []
    for changed_body, changed_source in [(body + b" ", "aws_cloudtrail"), (body, "linux_journal")]:
        refused = client.post(
            "/api/v1/events/upload",
            params={"source_type": changed_source, "preview_fingerprint": data["fingerprint"]},
            files={"file": ("cloudtrail.json", changed_body)},
        )
        assert refused.status_code == 409
    imported = client.post(
        "/api/v1/events/upload",
        params={**params, "preview_fingerprint": data["fingerprint"]},
        files={"file": ("cloudtrail.json", body)},
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["received"], result["ingested"], result["skipped"], result["redacted"]) == (3, 1, 2, 1)
    assert result["skip_reasons"] == data["skip_reasons"]
    with ledger[-1]() as db:
        saved = db.execute(select(SecurityEvent)).scalar_one()
        source = db.execute(select(EventSource)).scalar_one()
        assert saved.user_id == source.user_id == owner.id
        assert saved.source_id == source.id == result["source_id"]
        assert saved.source_type == source.source_type == "aws_cloudtrail"
        assert saved.timestamp.replace(tzinfo=UTC) == datetime(2026, 1, 1, tzinfo=UTC)
        assert saved.username == "recorded-caller" and saved.severity == "info"
        assert saved.raw_data["requestParameters"]["note"] == "[REDACTED_EMAIL]"
