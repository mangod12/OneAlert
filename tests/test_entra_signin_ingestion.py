"""Explicit file-only Graph sign-in intake preserves recorded facts and scope."""

import copy
import gzip
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.security_event import EventSource, SecurityEvent
from backend.routers.auth import get_current_user
from backend.services.event_ingestion import inspect_event_record
from backend.services.event_parser_preview import preview_event_file
from backend.services.event_upload import parse_event_upload
from backend.services.parsers.entra_signin import parse_entra_signin


def record():
    return {
        "id": "synthetic-signin-1",
        "createdDateTime": "2026-01-01T05:30:00.123456+05:30",
        "appId": "a1b2c3d4-e5f6-4000-8abc-a1b2c3d4e5f6",
        "appDisplayName": "Recorded application",
        "userPrincipalName": "recorded-caller@example.test",
        "userDisplayName": "Not the caller identity",
        "userId": "not-a-username",
        "resourceDisplayName": "Not the application",
        "ipAddress": "192.0.2.10",
        "status": {"errorCode": 50126, "failureReason": "Recorded text, not a verified outcome"},
        "deviceDetail": {"displayName": "not-a-hostname", "browser": "not-a-user-agent"},
        "location": {"city": "not-an-endpoint"},
        "riskLevelAggregated": "hidden",
        "conditionalAccessStatus": "success",
        "note": "private-person@example.test",
    }


def test_shared_raw_redaction_can_mask_identifier_parts_without_replacing_normalized_application_label():
    raw = record()
    raw["appId"] = "00000000-0000-4000-8000-000000000001"
    raw["appDisplayName"] = None
    parsed, reason, count = inspect_event_record(raw, parse_entra_signin)
    assert reason is None and count == 4
    assert parsed["signature"] == f"Entra sign-in: {raw['appId']}"
    assert parsed["raw_data"]["appId"] != raw["appId"]


def test_normalizes_only_recorded_signin_fields_without_verdict_or_target_inference():
    raw = record()
    before = copy.deepcopy(raw)
    parsed, reason, redactions = inspect_event_record(raw, parse_entra_signin)
    assert reason is None and redactions == 2 and raw == before
    assert parsed["timestamp"].isoformat() == "2026-01-01T00:00:00.123456+00:00"
    assert parsed["source_type"] == parsed["event_type"] == "entra_signin"
    assert parsed["signature"] == "Entra sign-in: Recorded application"
    assert parsed["category"] == "identity_signin" and parsed["severity"] == "info"
    assert parsed["action"] == "recorded_error_code:50126"
    assert parsed["username"] == "recorded-caller@example.test" and parsed["source_ip"] == "192.0.2.10"
    assert all(
        parsed.get(key) is None
        for key in ["hostname", "dest_ip", "source_port", "user_agent", "domain", "url", "signature_id"]
    )
    assert parsed["raw_data"]["note"] == "[REDACTED_EMAIL]"
    assert parsed["raw_data"]["userPrincipalName"] == "[REDACTED_EMAIL]"


@pytest.mark.parametrize("risk", [None, "none", "hidden", "unknownFutureValue", "high", "confirmedCompromised"])
@pytest.mark.parametrize("code", [0, 50126])
def test_risk_and_conditional_access_never_become_threat_severity_or_an_execution_verdict(risk, code):
    raw = record()
    raw.update(riskLevelAggregated=risk, riskState=risk, conditionalAccessStatus="failure")
    raw["status"]["errorCode"] = code
    parsed = parse_entra_signin(raw)
    assert parsed["severity"] == "info" and parsed["action"] == f"recorded_error_code:{code}"


@pytest.mark.parametrize("field", ["id", "appId", "status"])
def test_unrelated_and_incomplete_record_shapes_are_not_guessed(field):
    raw = record()
    raw.pop(field)
    assert parse_entra_signin(raw) is None
    assert parse_entra_signin({"properties": record()}) is None
    assert parse_entra_signin({"activityDateTime": raw["createdDateTime"], "activityDisplayName": "Audit"}) is None


@pytest.mark.parametrize(
    "timestamp", [None, "", "bad", "2026-01-01T00:00:00", "2026-02-30T00:00:00Z", 1767225600, True, {}, []]
)
def test_invalid_recorded_time_never_uses_clock_or_other_timestamp(timestamp):
    raw = record()
    raw.update(createdDateTime=timestamp, timestamp="2026-01-01T00:00:00Z", eventTime="2026-01-01T00:00:00Z")
    assert inspect_event_record(raw, parse_entra_signin)[1] == "invalid_timestamp"
    raw.pop("createdDateTime")
    assert inspect_event_record(raw, parse_entra_signin)[1] == "invalid_timestamp"


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", ""),
        ("id", None),
        ("id", True),
        ("id", "x" * 513),
        ("appId", []),
        ("appId", " "),
        ("appDisplayName", {}),
        ("appDisplayName", "x" * 1025),
        ("userPrincipalName", True),
        ("userPrincipalName", ["caller"]),
        ("userPrincipalName", "x" * 1025),
        ("status", None),
        ("status", []),
        ("status", {}),
        ("status", {"errorCode": True}),
        ("status", {"errorCode": "0"}),
        ("status", {"errorCode": 0.0}),
        ("status", {"errorCode": -1}),
        ("status", {"errorCode": 2147483648}),
        ("ipAddress", True),
        ("ipAddress", {}),
        ("ipAddress", "example.test"),
        ("ipAddress", "192.0.2.999"),
        ("ipAddress", "fe80::1%eth0"),
        ("ipAddress", "192.0.2.1:443"),
    ],
)
def test_invalid_used_fields_are_not_stringified_or_substituted(field, value):
    raw = record()
    raw[field] = value
    assert inspect_event_record(raw, parse_entra_signin)[1] == "parse_error"


@pytest.mark.parametrize("value", [None, "", "  "])
def test_absent_optional_names_never_borrow_display_names_ids_or_resource_targets(value):
    raw = record()
    raw.update(appDisplayName=value, userPrincipalName=value, ipAddress=value)
    parsed = parse_entra_signin(raw)
    assert parsed["username"] is None and parsed["source_ip"] is None
    assert parsed["signature"] == f"Entra sign-in: {raw['appId']}"
    for field in ["appDisplayName", "userPrincipalName", "ipAddress"]:
        raw.pop(field)
    assert parse_entra_signin(raw)["username"] is None


@pytest.mark.parametrize("address", ["192.0.2.10", "2001:db8::1"])
def test_only_direct_literal_ipv4_or_ipv6_are_endpoints(address):
    raw = record()
    raw["ipAddress"] = address
    assert parse_entra_signin(raw)["source_ip"] == address


@pytest.mark.parametrize("shape", ["object", "array", "ndjson", "envelope"])
def test_supported_shapes_have_identical_metadata_only_acceptance_and_original_byte_binding(shape):
    raw = record()
    body = (
        json.dumps(raw)
        if shape == "object"
        else json.dumps([raw])
        if shape == "array"
        else json.dumps(raw) + "\n{}\n"
        if shape == "ndjson"
        else json.dumps(
            {
                "@odata.context": "synthetic-context",
                "@odata.nextLink": "https://example.invalid/PRIVATE_CURSOR",
                "value": [raw],
            }
        )
    )
    data = preview_event_file(body.encode(), "entra_signin")
    assert (data["received"], data["accepted"], data["skipped"]) == (
        2 if shape == "ndjson" else 1,
        1,
        1 if shape == "ndjson" else 0,
    )
    assert data["redactions_in_accepted"] == 2
    assert not any(
        marker in json.dumps(data)
        for marker in ["PRIVATE_CURSOR", "private-person", "recorded-caller", "Recorded application", "raw_data"]
    )


@pytest.mark.parametrize(
    "envelope",
    [
        {"value": []},
        {"value": None},
        {"value": {}},
        {"value": [None]},
        {"value": [{}], "unexpected": "private"},
        {"value": [{}], "@odata.count": 1},
        {"value": [{}], "@odata.context": None},
        {"value": [{}], "@odata.nextLink": {}},
        {"value": [{}], "@odata.nextLink": " "},
        {"value": [{}] * 50001},
    ],
)
def test_invalid_envelopes_are_rejected_whole_before_ingestion(envelope):
    with pytest.raises(HTTPException):
        parse_event_upload(json.dumps(envelope).encode(), "entra_signin")


def test_envelope_is_only_unwrapped_for_explicit_parser_and_never_recursively():
    raw = record()
    body = json.dumps({"value": [raw]}).encode()
    assert parse_event_upload(body, "entra_signin") == [raw]
    for parser in [None, "aws_cloudtrail", "linux_journal", "suricata"]:
        assert parse_event_upload(body, parser) == [{"value": [raw]}]
    assert preview_event_file(json.dumps({"value": [{"value": [raw]}]}).encode(), "entra_signin")["accepted"] == 0
    assert preview_event_file(json.dumps({"Records": [raw]}).encode(), "entra_signin")["accepted"] == 0


@pytest.mark.parametrize(
    "body",
    [
        b'{"value":[],"value":[{}]}',
        b'{"value":[{"x":NaN}]}',
        b'{"value":[{}],"@odata.nextLink":"a","@odata.nextLink":"b"}',
        b'{"value":[{"status":{"errorCode":0,"errorCode":1}}]}',
        b"\xff{}",
    ],
)
def test_ambiguous_fields_nonstandard_numbers_and_invalid_utf8_remain_rejected(body):
    with pytest.raises(HTTPException):
        parse_event_upload(body, "entra_signin")


def test_gzip_and_encoded_record_strings_are_not_silently_decoded():
    with pytest.raises(HTTPException):
        parse_event_upload(gzip.compress(json.dumps(record()).encode()), "entra_signin")
    with pytest.raises(HTTPException):
        parse_event_upload(json.dumps({"value": [json.dumps(record())]}).encode(), "entra_signin")


def test_record_cap_and_nesting_limit_are_not_bypassed_by_value_envelope():
    assert len(parse_event_upload(json.dumps({"value": [{}] * 50000}).encode(), "entra_signin")) == 50000
    deep = b'{"value":[' + b'{"x":' * 64 + b"{}" + b"}" * 64 + b"]}"
    with pytest.raises(HTTPException):
        parse_event_upload(deep, "entra_signin")


def test_preview_no_sql_bound_import_owned_storage_and_no_continuation_retention(ledger):
    client, owner, other, _, sessions = ledger
    raw, bad = record(), record()
    bad["createdDateTime"] = "bad"
    body = json.dumps(
        {
            "@odata.context": "synthetic-context",
            "@odata.nextLink": "https://example.invalid/PRIVATE_CURSOR",
            "value": [raw, bad, {}],
        }
    ).encode()
    statements = []
    event.listen(Engine, "before_cursor_execute", listener := lambda _c, _u, sql, _p, _x, _m: statements.append(sql))
    try:
        preview = client.post(
            "/api/v1/events/upload/preview",
            params={"source_type": "entra_signin"},
            files={"file": ("entra.json", body)},
        )
    finally:
        event.remove(Engine, "before_cursor_execute", listener)
    assert preview.status_code == 200, preview.text
    assert statements == []
    data = preview.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (3, 1, 2)
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "unsupported_record": 1}
    assert data["skipped_positions"]["invalid_timestamp"]["record_positions"] == [2]
    assert "PRIVATE_CURSOR" not in preview.text
    for changed_body, changed_parser in [(body + b" ", "entra_signin"), (body, "aws_cloudtrail")]:
        refused = client.post(
            "/api/v1/events/upload",
            params={"source_type": changed_parser, "preview_fingerprint": data["fingerprint"]},
            files={"file": ("entra.json", changed_body)},
        )
        assert refused.status_code == 409
    with sessions() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []
    imported = client.post(
        "/api/v1/events/upload",
        params={"source_type": "entra_signin", "preview_fingerprint": data["fingerprint"]},
        files={"file": ("entra.json", body)},
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["received"], result["ingested"], result["skipped"], result["redacted"]) == (3, 1, 2, 2)
    assert result["skip_reasons"] == data["skip_reasons"] and "PRIVATE_CURSOR" not in imported.text
    with sessions() as db:
        saved = db.execute(select(SecurityEvent)).scalar_one()
        source = db.execute(select(EventSource)).scalar_one()
        assert saved.user_id == source.user_id == owner.id and saved.source_id == result["source_id"]
        assert saved.source_type == source.source_type == "entra_signin"
        assert "@odata.nextLink" not in json.dumps(saved.raw_data) and "PRIVATE_CURSOR" not in json.dumps(
            saved.raw_data
        )
        assert saved.username == raw["userPrincipalName"] and saved.raw_data["note"] == "[REDACTED_EMAIL]"

    async def other_user():
        return other

    app.dependency_overrides[get_current_user] = other_user
    hidden = client.get("/api/v1/events/", params={"source_type": "entra_signin"})
    assert hidden.status_code == 200 and hidden.json()["events"] == []
    assert client.get("/api/v1/events/sources").json() == []


def test_invalid_envelope_never_invokes_ingestion_and_auth_boundaries_remain(ledger, monkeypatch):
    from unittest.mock import AsyncMock

    import backend.services.event_ingestion as service

    ingestion = AsyncMock()
    monkeypatch.setattr(service, "ingest_events", ingestion)
    client, owner = ledger[0], ledger[1]
    for endpoint in ["/api/v1/events/upload/preview", "/api/v1/events/upload"]:
        bad = client.post(
            endpoint,
            params={"source_type": "entra_signin"},
            files={"file": ("bad.json", b'{"value":[{}],"extra":true}')},
        )
        assert bad.status_code == 400
        owner.is_active = False
        assert (
            client.post(
                endpoint, params={"source_type": "entra_signin"}, files={"file": ("ok.json", b"{}")}
            ).status_code
            == 400
        )
        owner.is_active = True
    ingestion.assert_not_awaited()
    app.dependency_overrides.pop(get_current_user)
    assert (
        client.post(
            "/api/v1/events/upload/preview", params={"source_type": "entra_signin"}, files={"file": ("ok.json", b"{}")}
        ).status_code
        == 401
    )
