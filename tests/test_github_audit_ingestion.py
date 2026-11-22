"""File-only GitHub audit intake preserves millisecond time and actor semantics."""

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
from backend.services.parsers.github_audit import CONTEXT_FIELDS, parse_github_audit


def record():
    return {
        "_document_id": "synthetic-audit-1",
        "created_at": 1767225600123,
        "@timestamp": 0,
        "action": "repo.destroy",
        "actor": "recorded-actor",
        "user": "different-affected-user",
        "actor_id": 123,
        "target_login": "different-target",
        "org": "synthetic-org",
        "repo": "synthetic-org/example-repository",
        "actor_location": {"country_code": "ZZ"},
        "actor_ip": "192.0.2.10",
        "user_agent": "recorded client, not used for endpoint inference",
        "data": {"email": "private-person@example.test"},
    }


def test_recorded_actor_action_and_exact_milliseconds_are_not_target_identity_or_verified_execution():
    raw = record()
    before = copy.deepcopy(raw)
    parsed, reason, count = inspect_event_record(raw, parse_github_audit)
    assert reason is None and count == 1 and raw == before
    assert parsed["timestamp"] == datetime(2026, 1, 1, microsecond=123000, tzinfo=UTC)
    assert parsed["event_type"] == parsed["source_type"] == "github_audit"
    assert parsed["signature"] == "GitHub audit: repo.destroy" and parsed["severity"] == "info"
    assert parsed["category"] == "github_audit" and parsed["username"] == "recorded-actor"
    for key in ["action", "source_ip", "dest_ip", "hostname", "domain", "url", "user_agent", "signature_id"]:
        assert parsed.get(key) is None
    assert parsed["raw_data"]["data"]["email"] == "[REDACTED_EMAIL]"
    assert parsed["raw_data"]["user"] == "different-affected-user"
    assert parsed["raw_data"]["@timestamp"] == 0


@pytest.mark.parametrize(
    "value,expected",
    [
        (0, datetime(1970, 1, 1, tzinfo=UTC)),
        (1, datetime(1970, 1, 1, microsecond=1000, tzinfo=UTC)),
        (1767225600999, datetime(2026, 1, 1, microsecond=999000, tzinfo=UTC)),
        (253402300799999, datetime(9999, 12, 31, 23, 59, 59, 999000, tzinfo=UTC)),
        (1767225600, datetime(1970, 1, 21, 10, 53, 45, 600000, tzinfo=UTC)),
    ],
)
def test_integer_milliseconds_are_exact_without_rounding_or_seconds_heuristics(value, expected):
    raw = record()
    raw["created_at"] = value
    assert parse_github_audit(raw)["timestamp"] == expected


@pytest.mark.parametrize(
    "value", [None, "", "1767225600123", "2026-01-01T00:00:00Z", True, False, 1.0, -1, {}, [], 253402300800000, 2**200]
)
def test_invalid_created_at_never_falls_back_to_timestamp_or_current_clock(value):
    raw = record()
    raw.update(created_at=value, timestamp="2026-01-01T00:00:00Z")
    raw["@timestamp"] = 1767225600123
    assert inspect_event_record(raw, parse_github_audit)[1] == "invalid_timestamp"
    raw.pop("created_at")
    assert inspect_event_record(raw, parse_github_audit)[1] == "invalid_timestamp"


@pytest.mark.parametrize(
    "field,value",
    [
        ("action", None),
        ("action", True),
        ("action", {}),
        ("action", ""),
        ("action", " "),
        ("action", "x" * 513),
        ("actor", True),
        ("actor", []),
        ("actor", {}),
        ("actor", "x" * 513),
    ],
)
def test_used_text_is_not_stringified_or_silently_shortened(field, value):
    raw = record()
    raw[field] = value
    assert inspect_event_record(raw, parse_github_audit)[1] == "parse_error"


@pytest.mark.parametrize("value", [None, "", " "])
def test_missing_actor_never_borrows_affected_user_target_or_numeric_actor_id(value):
    raw = record()
    raw["actor"] = value
    assert parse_github_audit(raw)["username"] is None
    raw.pop("actor")
    assert parse_github_audit(raw)["username"] is None


@pytest.mark.parametrize("context", CONTEXT_FIELDS)
def test_one_direct_recorded_audit_context_is_sufficient_without_org_or_repo_inference(context):
    raw = {key: value for key, value in record().items() if key not in CONTEXT_FIELDS}
    raw[context] = "recorded-context"
    assert parse_github_audit(raw)["source_type"] == "github_audit"


@pytest.mark.parametrize("value", [None, "", " ", 123, True, {}, [], "x" * 1025])
def test_generic_action_time_or_unusable_context_is_not_guessed_as_native_audit(value):
    raw = {key: item for key, item in record().items() if key not in CONTEXT_FIELDS}
    assert parse_github_audit(raw) is None
    raw["org"] = value
    assert parse_github_audit(raw) is None
    assert parse_github_audit({"properties": record()}) is None
    assert parse_github_audit({"org": "example", "created_at": 0}) is None


@pytest.mark.parametrize(
    "action",
    ["team.create", "org.remove_member", "git.clone", "code-scanning.enable", "unknown_future.recorded_action"],
)
def test_unknown_action_labels_do_not_become_threat_or_access_decisions(action):
    raw = record()
    raw.update(action=action, severity="critical", result="failure", read_only=False)
    parsed = parse_github_audit(raw)
    assert parsed["signature"] == f"GitHub audit: {action}" and parsed["severity"] == "info"
    assert parsed.get("action") is None


@pytest.mark.parametrize("shape", ["object", "array", "ndjson"])
def test_plain_native_shapes_use_identical_metadata_only_preview_and_bind_original_bytes(shape):
    raw = record()
    body = json.dumps(raw) if shape == "object" else json.dumps([raw]) if shape == "array" else json.dumps(raw) + "\n"
    data = preview_event_file(body.encode(), "github_audit")
    assert (data["received"], data["accepted"], data["skipped"], data["redactions_in_accepted"]) == (1, 1, 0, 1)
    assert not any(
        value in json.dumps(data) for value in ["recorded-actor", "different-target", "private-person", "raw_data"]
    )


@pytest.mark.parametrize(
    "wrapper", [{"value": [record()]}, {"Records": [record()]}, {"edges": [{"node": record()}]}, {"events": [record()]}]
)
def test_provider_wrappers_are_not_implicitly_or_recursively_unpacked(wrapper):
    body = json.dumps(wrapper).encode()
    assert parse_event_upload(body, "github_audit") == [wrapper]
    assert preview_event_file(body, "github_audit")["accepted"] == 0


def test_gzip_and_json_encoded_strings_remain_unsupported():
    with pytest.raises(HTTPException):
        parse_event_upload(gzip.compress(json.dumps(record()).encode()), "github_audit")
    with pytest.raises(HTTPException):
        parse_event_upload(json.dumps([json.dumps(record())]).encode(), "github_audit")


@pytest.mark.parametrize(
    "body",
    [
        b'{"action":"first","action":"second"}',
        b'{"org":"example","created_at":NaN}',
        b"{}\nbroken\n{}",
        b"\xff{}",
        b"[]",
    ],
)
def test_ambiguous_invalid_or_empty_files_are_rejected_before_preview(body):
    with pytest.raises(HTTPException):
        preview_event_file(body, "github_audit")


def test_preview_no_sql_bound_import_same_owned_storage_and_no_other_account_visibility(ledger):
    client, owner, other, _, sessions = ledger
    bad = record()
    bad["created_at"] = "bad"
    body = json.dumps([record(), bad, {}]).encode()
    statements = []
    event.listen(Engine, "before_cursor_execute", listener := lambda _c, _u, sql, _p, _x, _m: statements.append(sql))
    try:
        preview = client.post(
            "/api/v1/events/upload/preview",
            params={"source_type": "github_audit"},
            files={"file": ("audit.json", body)},
        )
    finally:
        event.remove(Engine, "before_cursor_execute", listener)
    assert preview.status_code == 200 and statements == []
    data = preview.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (3, 1, 2)
    assert data["skip_reasons"] == {"invalid_timestamp": 1, "unsupported_record": 1}
    assert data["skipped_positions"]["invalid_timestamp"]["record_positions"] == [2]
    for changed_body, parser in [(body + b" ", "github_audit"), (body, "entra_signin")]:
        refused = client.post(
            "/api/v1/events/upload",
            params={"source_type": parser, "preview_fingerprint": data["fingerprint"]},
            files={"file": ("audit.json", changed_body)},
        )
        assert refused.status_code == 409
    with sessions() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []
    imported = client.post(
        "/api/v1/events/upload",
        params={"source_type": "github_audit", "preview_fingerprint": data["fingerprint"]},
        files={"file": ("audit.json", body)},
    )
    assert imported.status_code == 201, imported.text
    result = imported.json()["data"]
    assert (result["received"], result["ingested"], result["skipped"], result["redacted"]) == (3, 1, 2, 1)
    assert result["skip_reasons"] == data["skip_reasons"]
    with sessions() as db:
        saved = db.execute(select(SecurityEvent)).scalar_one()
        source = db.execute(select(EventSource)).scalar_one()
        assert saved.user_id == source.user_id == owner.id and saved.source_id == result["source_id"]
        assert saved.source_type == source.source_type == "github_audit"
        assert saved.timestamp.replace(tzinfo=UTC) == datetime(2026, 1, 1, microsecond=123000, tzinfo=UTC)
        assert saved.username == "recorded-actor" and saved.action is None and saved.source_ip is None
        assert saved.raw_data["data"]["email"] == "[REDACTED_EMAIL]"

    async def other_user():
        return other

    app.dependency_overrides[get_current_user] = other_user
    assert client.get("/api/v1/events/", params={"source_type": "github_audit"}).json()["events"] == []
    assert client.get("/api/v1/events/sources").json() == []


def test_new_preview_keeps_active_user_and_authentication_boundary(ledger):
    client, owner = ledger[0], ledger[1]
    body = json.dumps(record()).encode()
    owner.is_active = False
    assert (
        client.post(
            "/api/v1/events/upload/preview",
            params={"source_type": "github_audit"},
            files={"file": ("audit.json", body)},
        ).status_code
        == 400
    )
    app.dependency_overrides.pop(get_current_user)
    assert (
        client.post(
            "/api/v1/events/upload/preview",
            params={"source_type": "github_audit"},
            files={"file": ("audit.json", body)},
        ).status_code
        == 401
    )
