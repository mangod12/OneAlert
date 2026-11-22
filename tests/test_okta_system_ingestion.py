"""Supplied Okta System Log intake preserves publication and actor semantics."""

import copy
import gzip
import json
from datetime import UTC, datetime

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
from backend.services.parsers.okta_system import parse_okta_system


def record():
    return {
        "uuid": "synthetic-okta-event-1",
        "eventType": "user.lifecycle.deactivate",
        "published": "2026-01-01T05:30:00.123456+05:30",
        "actor": {
            "type": "User",
            "alternateId": "recorded-actor",
            "displayName": "different-display",
            "id": "different-id",
        },
        "client": {"ipAddress": "192.0.2.10", "userAgent": {"rawUserAgent": "not-normalized"}},
        "outcome": {"result": "SUCCESS", "reason": "unverified reason"},
        "target": [{"type": "User", "alternateId": "different-target"}],
        "request": {"ipChain": [{"ip": "198.51.100.12"}]},
        "severity": "ERROR",
        "data": {"email": "private-person@example.test"},
    }


def test_normalizes_only_recorded_user_client_outcome_and_publication_time_without_verdicts():
    raw = record()
    before = copy.deepcopy(raw)
    parsed, reason, count = inspect_event_record(raw, parse_okta_system)
    assert reason is None and count == 1 and raw == before
    assert parsed["timestamp"] == datetime(2026, 1, 1, microsecond=123456, tzinfo=UTC)
    assert parsed["source_type"] == parsed["event_type"] == "okta_system"
    assert parsed["signature"] == "Okta System Log: user.lifecycle.deactivate"
    assert parsed["severity"] == "info" and parsed["category"] == "identity_audit"
    assert parsed["username"] == "recorded-actor" and parsed["source_ip"] == "192.0.2.10"
    assert parsed["action"] == "recorded_outcome:SUCCESS"
    assert parsed["raw_data"]["data"]["email"] == "[REDACTED_EMAIL]"
    for key in ["dest_ip", "hostname", "domain", "url", "user_agent", "signature_id"]:
        assert parsed.get(key) is None


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "2026-01-01",
        "2026-01-01T00:00:00",
        "2026-01-01T00:00Z",
        "2026-01-01T00:00:00.1234567Z",
        "2026-02-30T00:00:00Z",
        "2026-01-01T00:00:00+00:99",
        "2026-01-01T00:00:00+24:00",
        1767225600,
        True,
        1.0,
        {},
        [],
        "0001-01-01T00:00:00+01:00",
        "9999-12-31T23:59:59-01:00",
    ],
)
def test_invalid_publication_has_no_other_timestamp_or_current_clock_fallback(value):
    raw = record()
    raw.update(published=value, timestamp="2026-01-01T00:00:00Z", created_at=1767225600123)
    assert inspect_event_record(raw, parse_okta_system)[1] == "invalid_timestamp"
    raw.pop("published")
    assert inspect_event_record(raw, parse_okta_system)[1] == "invalid_timestamp"


@pytest.mark.parametrize(
    "value,expected",
    [
        ("2026-01-01T00:00:00Z", datetime(2026, 1, 1, tzinfo=UTC)),
        ("2025-12-31T19:00:00-05:00", datetime(2026, 1, 1, tzinfo=UTC)),
        ("2026-01-01T00:00:00.001Z", datetime(2026, 1, 1, microsecond=1000, tzinfo=UTC)),
    ],
)
def test_published_offsets_and_microseconds_are_preserved(value, expected):
    raw = record()
    raw["published"] = value
    assert parse_okta_system(raw)["timestamp"] == expected


@pytest.mark.parametrize("actor_type", [None, "", " ", "AppInstance", "SystemPrincipal", "user", "FutureActor"])
def test_non_user_actor_does_not_become_a_username(actor_type):
    raw = record()
    raw["actor"]["type"] = actor_type
    assert parse_okta_system(raw)["username"] is None
    raw["actor"].pop("type")
    assert parse_okta_system(raw)["username"] is None


@pytest.mark.parametrize("value", [None, "", " "])
def test_absent_user_label_never_borrows_actor_id_display_name_or_target_user(value):
    raw = record()
    raw["actor"]["alternateId"] = value
    assert parse_okta_system(raw)["username"] is None
    raw["actor"].pop("alternateId")
    assert parse_okta_system(raw)["username"] is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("uuid", None),
        ("uuid", ""),
        ("uuid", 123),
        ("eventType", True),
        ("eventType", ""),
        ("eventType", "x" * 513),
        ("actor", None),
        ("actor", []),
        ("client", False),
        ("client", []),
        ("outcome", "SUCCESS"),
        ("outcome", []),
    ],
)
def test_malformed_used_context_is_skipped_without_coercion(field, value):
    raw = record()
    raw[field] = value
    assert inspect_event_record(raw, parse_okta_system)[1] == "parse_error"


@pytest.mark.parametrize(
    "section,key,value",
    [
        ("actor", "type", True),
        ("actor", "alternateId", 1),
        ("actor", "alternateId", "x" * 513),
        ("client", "ipAddress", True),
        ("client", "ipAddress", "not-an-ip"),
        ("client", "ipAddress", "https://example.invalid"),
        ("client", "ipAddress", "fe80::1%eth0"),
        ("outcome", "result", False),
        ("outcome", "result", "x" * 513),
    ],
)
def test_bad_used_nested_scalar_is_not_stringified_or_replaced(section, key, value):
    raw = record()
    raw[section][key] = value
    assert inspect_event_record(raw, parse_okta_system)[1] == "parse_error"


@pytest.mark.parametrize("value", [None, {}, {"ipAddress": ""}])
def test_no_direct_client_ip_never_uses_ip_chain_or_context(value):
    raw = record()
    raw["client"] = value
    assert parse_okta_system(raw)["source_ip"] is None
    raw.pop("client")
    assert parse_okta_system(raw)["source_ip"] is None


def test_ipv6_recorded_spelling_and_unknown_outcome_remain_labels_not_authentication_verdicts():
    raw = record()
    raw["client"]["ipAddress"] = "2001:DB8::1"
    for result in ["SUCCESS", "FAILURE", "SKIPPED", "FUTURE_RESULT", None, ""]:
        raw["outcome"]["result"] = result
        parsed = parse_okta_system(raw)
        assert parsed["source_ip"] == "2001:DB8::1" and parsed["severity"] == "info"
        assert parsed["action"] == (f"recorded_outcome:{result}" if result else None)
    raw.pop("outcome")
    assert parse_okta_system(raw)["action"] is None


@pytest.mark.parametrize("key", ["uuid", "eventType", "actor"])
def test_require_native_system_log_marker_keys_not_generic_identity_json(key):
    raw = record()
    raw.pop(key)
    assert parse_okta_system(raw) is None


@pytest.mark.parametrize("shape", ["object", "array", "ndjson"])
def test_plain_shapes_preview_metadata_without_raw_values(shape):
    raw = record()
    text = json.dumps(raw) if shape == "object" else json.dumps([raw]) if shape == "array" else json.dumps(raw) + "\n"
    data = preview_event_file(text.encode(), "okta_system")
    assert (data["received"], data["accepted"], data["skipped"], data["redactions_in_accepted"]) == (1, 1, 0, 1)
    assert not any(
        value in json.dumps(data) for value in ["recorded-actor", "different-target", "private-person", "raw_data"]
    )


@pytest.mark.parametrize(
    "wrapper",
    [{"data": {"events": [record()]}}, {"events": [record()]}, {"value": [record()]}, {"Records": [record()]}],
)
def test_event_hooks_and_provider_wrappers_are_not_recursively_unpacked(wrapper):
    body = json.dumps(wrapper).encode()
    assert parse_event_upload(body, "okta_system") == [wrapper]
    assert preview_event_file(body, "okta_system")["accepted"] == 0


def test_gzip_encoded_json_and_ambiguous_whole_files_are_rejected():
    for body in [
        gzip.compress(json.dumps(record()).encode()),
        json.dumps([json.dumps(record())]).encode(),
        b'{"uuid":"one","uuid":"two"}',
        b"{}\nbroken\n{}",
        b"\xff{}",
        b"[]",
    ]:
        with pytest.raises(HTTPException):
            preview_event_file(body, "okta_system")


def test_preview_no_sql_bound_import_same_owned_storage_and_no_other_account_visibility(ledger):
    client, owner, other, _, sessions = ledger
    bad = record()
    bad["published"] = "bad"
    body = json.dumps([record(), bad, {}]).encode()
    statements = []
    event.listen(Engine, "before_cursor_execute", listener := lambda _c, _u, sql, _p, _x, _m: statements.append(sql))
    try:
        preview = client.post(
            "/api/v1/events/upload/preview", params={"source_type": "okta_system"}, files={"file": ("okta.json", body)}
        )
    finally:
        event.remove(Engine, "before_cursor_execute", listener)
    assert preview.status_code == 200 and statements == []
    data = preview.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (3, 1, 2)
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "unsupported_record": 1}
    for changed_body, parser in [(body + b" ", "okta_system"), (body, "github_audit")]:
        assert (
            client.post(
                "/api/v1/events/upload",
                params={"source_type": parser, "preview_fingerprint": data["fingerprint"]},
                files={"file": ("okta.json", changed_body)},
            ).status_code
            == 409
        )
    with sessions() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []
    imported = client.post(
        "/api/v1/events/upload",
        params={"source_type": "okta_system", "preview_fingerprint": data["fingerprint"]},
        files={"file": ("okta.json", body)},
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["received"], result["ingested"], result["skipped"], result["redacted"]) == (3, 1, 2, 1)
    assert result["skip_reasons"] == data["skip_reasons"]
    with sessions() as db:
        saved = db.execute(select(SecurityEvent)).scalar_one()
        source = db.execute(select(EventSource)).scalar_one()
        assert saved.user_id == source.user_id == owner.id and saved.source_id == result["source_id"]
        assert saved.source_type == source.source_type == "okta_system"
        assert saved.timestamp.replace(tzinfo=UTC) == datetime(2026, 1, 1, microsecond=123456, tzinfo=UTC)
        assert saved.username == "recorded-actor" and saved.action == "recorded_outcome:SUCCESS"
        assert saved.source_ip == "192.0.2.10" and saved.severity == "info"
        assert saved.raw_data["data"]["email"] == "[REDACTED_EMAIL]"

    async def other_user():
        return other

    app.dependency_overrides[get_current_user] = other_user
    assert client.get("/api/v1/events/", params={"source_type": "okta_system"}).json()["events"] == []
    assert client.get("/api/v1/events/sources").json() == []


def test_preview_keeps_active_user_and_authentication_boundary(ledger):
    client, owner = ledger[0], ledger[1]
    body = json.dumps(record()).encode()
    owner.is_active = False
    assert (
        client.post(
            "/api/v1/events/upload/preview", params={"source_type": "okta_system"}, files={"file": ("okta.json", body)}
        ).status_code
        == 400
    )
    app.dependency_overrides.pop(get_current_user)
    assert (
        client.post(
            "/api/v1/events/upload/preview", params={"source_type": "okta_system"}, files={"file": ("okta.json", body)}
        ).status_code
        == 401
    )
