"""Parser previews are metadata-only and bind an optional later import to exact bytes."""

import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.security_event import EventSource, SecurityEvent
from backend.routers.auth import get_current_user
from backend.services.event_parser_preview import event_preview_fingerprint, preview_event_file

STAMP = "2026-01-01T00:00:00Z"
PATH = "/api/v1/events/upload"


def content(records):
    return json.dumps(records).encode()


def test_preview_matches_actual_mixed_import_and_does_not_echo_raw_or_normalized_values(ledger):
    records = [
        {"timestamp": STAMP, "event_type": "alert", "note": "private-person@example.test"},
        {"timestamp": STAMP, "event_type": "alert", "src_port": {}},
        {"event_type": "alert", "note": "private-second@example.test"},
        {"timestamp": STAMP, "event_type": "alert", "alert": []},
    ]
    body = content(records)
    statements = []
    event.listen(Engine, "before_cursor_execute", listener := lambda _c, _u, sql, _p, _x, _m: statements.append(sql))
    try:
        preview = ledger[0].post(
            f"{PATH}/preview", params={"source_type": "suricata"}, files={"file": ("input.json", body)}
        )
    finally:
        event.remove(Engine, "before_cursor_execute", listener)
    assert preview.status_code == 200, preview.text
    assert statements == []
    data = preview.json()["data"]
    assert data["received"] == 4 and data["accepted"] == 1 and data["skipped"] == 3
    assert data["redactions_in_accepted"] == 1
    assert data["skip_reasons"] == {"invalid_fields": 1, "invalid_timestamp": 1, "parse_error": 1}
    assert data["skipped_positions"]["invalid_fields"] == {"record_positions": [2], "omitted_positions": 0}
    assert "private-person" not in preview.text and "private-second" not in preview.text
    assert "raw_data" not in preview.text and "normalized_payload" not in data
    imported = ledger[0].post(
        PATH,
        params={"source_type": "suricata", "preview_fingerprint": data["fingerprint"]},
        files={"file": ("input.json", body)},
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
        assert saved.user_id == ledger[1].id and saved.raw_data["note"] == "[REDACTED_EMAIL]"
        assert db.execute(select(func.count(EventSource.id))).scalar_one() == 1


@pytest.mark.parametrize("change", ["bytes", "parser", "spaces"])
def test_modified_file_or_parser_is_refused_before_source_creation_or_ingestion(ledger, monkeypatch, change):
    import backend.services.event_ingestion as service

    body = content([{"timestamp": STAMP, "event_type": "alert"}])
    fingerprint = event_preview_fingerprint(body, "suricata")
    ingestion = AsyncMock()
    monkeypatch.setattr(service, "ingest_events", ingestion)
    submitted = body + (b" " if change == "spaces" else b"\n{}" if change == "bytes" else b"")
    response = ledger[0].post(
        PATH,
        params={"source_type": "zeek" if change == "parser" else "suricata", "preview_fingerprint": fingerprint},
        files={"file": ("input.json", submitted)},
    )
    assert response.status_code == 409, response.text
    ingestion.assert_not_awaited()
    with ledger[-1]() as db:
        assert db.execute(select(func.count(EventSource.id))).scalar_one() == 0
        assert db.execute(select(func.count(SecurityEvent.id))).scalar_one() == 0


def test_preview_lists_only_first_ten_record_positions_with_explicit_omitted_count():
    data = preview_event_file(content([{"event_type": "alert"}] * 23), "suricata")
    assert data["accepted"] == 0 and data["skipped"] == 23
    assert data["skipped_positions"] == {
        "invalid_timestamp": {"record_positions": list(range(1, 11)), "omitted_positions": 13}
    }


def test_zeek_preview_uses_actual_integer_timestamp_and_port_parser_contract():
    data = preview_event_file(
        content(
            [
                {"_path": "conn", "ts": 0, "id.orig_p": "0", "id.resp_p": "65535"},
                {"_path": "conn", "ts": 0, "id.orig_p": True},
                {"_path": "conn", "ts": "not-time"},
            ]
        ),
        "zeek",
    )
    assert data["accepted"] == 1 and data["skip_reasons"] == {"parse_error": 1, "invalid_timestamp": 1}


@pytest.mark.parametrize("body", [b"[]", b"{}\ninvalid", b"[{},null]", b'{"x":1,"x":2}', b'{"x":NaN}', b"\xff{}"])
def test_invalid_envelope_is_refused_without_ingestion(ledger, monkeypatch, body):
    import backend.services.event_ingestion as service

    ingestion = AsyncMock()
    monkeypatch.setattr(service, "ingest_events", ingestion)
    response = ledger[0].post(f"{PATH}/preview", files={"file": ("input.json", body)})
    assert response.status_code == 400
    ingestion.assert_not_awaited()


@pytest.mark.parametrize("parser", ["unknown", "SURICATA", "", "webhook"])
def test_preview_only_supports_the_dialogs_two_named_parsers(ledger, parser):
    response = ledger[0].post(f"{PATH}/preview", params={"source_type": parser}, files={"file": ("input.json", b"{}")})
    assert response.status_code == 422
    with pytest.raises(ValueError):
        preview_event_file(b"{}", parser)


def test_preview_authentication_and_active_user_are_required(ledger):
    ledger[1].is_active = False
    assert ledger[0].post(f"{PATH}/preview", files={"file": ("input.json", b"{}")}).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert ledger[0].post(f"{PATH}/preview", files={"file": ("input.json", b"{}")}).status_code == 401


def test_preview_retains_the_existing_file_and_record_caps(ledger):
    too_large = ledger[0].post(f"{PATH}/preview", files={"file": ("large.json", b" " * (10 * 1024 * 1024 + 1))})
    assert too_large.status_code == 413
    too_many = ledger[0].post(f"{PATH}/preview", files={"file": ("many.ndjson", b"{}\n" * 50001)})
    assert too_many.status_code == 400


def test_unsupported_record_reason_uses_shared_inspection_without_raw_exception_messages(monkeypatch):
    import backend.services.event_ingestion as service

    monkeypatch.setitem(service.PARSERS, "suricata", lambda _raw: None)
    assert preview_event_file(b"{}", "suricata")["skip_reasons"] == {"unsupported_record": 1}

    def fail(_raw):
        raise RuntimeError("PRIVATE-RAW-SECRET")

    monkeypatch.setitem(service.PARSERS, "suricata", fail)
    data = preview_event_file(b"{}", "suricata")
    assert data["skip_reasons"] == {"parse_error": 1} and "PRIVATE-RAW-SECRET" not in json.dumps(data)
