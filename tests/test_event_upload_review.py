"""Malformed import envelopes fail before ingestion or source creation."""

import asyncio
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException, UploadFile

from backend.routers.events import upload_events_file
from backend.services.event_upload import parse_event_upload


@pytest.mark.parametrize(
    "content,count",
    [
        (b'{"event_type":"alert"}', 1),
        (b'[{"id":1},{"id":2}]', 2),
        (b'\xef\xbb\xbf{"id":1}\n{"id":2}\n', 2),
        (b'\n{ "id": 1 }\r\n\n{"id":2}\r\n', 2),
        (b'{\n "event_type": "alert"\n}', 1),
    ],
)
def test_valid_envelopes_preserve_every_object(content, count):
    records = parse_event_upload(content)
    assert len(records) == count
    assert all(isinstance(record, dict) for record in records)


@pytest.mark.parametrize(
    "content,message",
    [
        (b"", "No JSON records"),
        (b"[]", "No JSON records"),
        (b"null", "Record 1"),
        (b"false", "Record 1"),
        (b"5", "Record 1"),
        (b"[{}, 1]", "Record 2"),
        (b"[{} , []]", "Record 2"),
        (b"{}\nnot-json\n{}", "line 2"),
        (b"{}\n\n[]", "Line 3"),
        (b'{"severity": NaN}', "Invalid JSON"),
        (b'{"x": Infinity}', "Invalid JSON"),
        (b"\xff{}", "UTF-8"),
        (b"\xef\xbb\xbf\xef\xbb\xbf{}", "Invalid JSON"),
    ],
)
def test_invalid_file_is_rejected_whole_not_silently_partially_imported(content, message):
    with pytest.raises(HTTPException) as error:
        parse_event_upload(content)
    assert error.value.status_code == 400
    assert message in error.value.detail


@pytest.mark.parametrize("newline", [False, True])
def test_record_cap_matches_array_and_newline_formats(newline):
    content = b"{}\n" * 50000 if newline else json.dumps([{}] * 50000).encode()
    assert len(parse_event_upload(content)) == 50000
    content = b"{}\n" * 50001 if newline else json.dumps([{}] * 50001).encode()
    with pytest.raises(HTTPException) as error:
        parse_event_upload(content)
    assert "50,000" in error.value.detail


def test_excessive_nesting_is_a_validation_error_not_internal_failure():
    with pytest.raises(HTTPException) as error:
        parse_event_upload(b'{"x":' * 1500 + b"0" + b"}" * 1500)
    assert error.value.status_code == 400


@pytest.mark.parametrize("content", [b"{}\nbroken\n{}", b"[{}, null]", b"\xff{}", b"[]"])
def test_upload_route_does_not_call_ingestion_for_an_invalid_envelope(monkeypatch, content):
    import backend.services.event_ingestion as service

    ingestion = AsyncMock()
    monkeypatch.setattr(service, "ingest_events", ingestion)
    db = Mock()
    with pytest.raises(HTTPException):
        asyncio.run(
            upload_events_file(
                UploadFile(filename="source.ndjson", file=io.BytesIO(content)),
                source_type="suricata",
                current_user=SimpleNamespace(id=7),
                db=db,
            )
        )
    ingestion.assert_not_awaited()
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_upload_uses_reviewed_objects_and_keeps_final_parser_skip_counts(monkeypatch):
    import backend.services.event_ingestion as service

    ingestion = AsyncMock(return_value={"ingested": 1, "skipped": 1, "redacted": 0, "source_id": 3})
    monkeypatch.setattr(service, "ingest_events", ingestion)
    db = Mock()
    output = asyncio.run(
        upload_events_file(
            UploadFile(filename="source.ndjson", file=io.BytesIO(b'{"id":1}\n{"id":2}')),
            source_type="zeek",
            current_user=SimpleNamespace(id=7),
            db=db,
        )
    )
    assert output["data"]["ingested"] == 1 and output["data"]["skipped"] == 1
    assert ingestion.call_args.kwargs == {
        "db": db,
        "user_id": 7,
        "raw_events": [{"id": 1}, {"id": 2}],
        "source_type": "zeek",
        "source_name": "source.ndjson",
    }


def test_nesting_limit_has_an_explicit_matching_boundary():
    assert len(parse_event_upload(b'{"x":' * 63 + b'{}' + b'}' * 63)) == 1
    with pytest.raises(HTTPException) as error:
        parse_event_upload(b'{"x":' * 64 + b'{}' + b'}' * 64)
    assert '64 levels' in error.value.detail


@pytest.mark.parametrize('content', [
    b'{"severity":"critical","severity":"low"}',
    b'[{"id":1},{"id":2,"raw":{"ip":"first","ip":"second"}}]',
    b'{"id":1}\n{"event_type":"alert","event_type":"flow"}\n{"id":3}',
    b'{"signature":"first","signat\\u0075re":"second"}',
    b'{"same":"value","same":"value"}',
])
def test_duplicate_fields_at_any_depth_reject_the_whole_import_without_writes(monkeypatch, content):
    import backend.services.event_ingestion as service

    ingestion = AsyncMock()
    monkeypatch.setattr(service, 'ingest_events', ingestion)
    db = Mock()
    with pytest.raises(HTTPException) as error:
        asyncio.run(upload_events_file(
            UploadFile(filename='ambiguous.json', file=io.BytesIO(content)),
            source_type='suricata', current_user=SimpleNamespace(id=7), db=db))
    assert error.value.status_code == 400
    assert 'Invalid JSON' in error.value.detail
    assert len(error.value.detail) < 100
    ingestion.assert_not_awaited()
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_names_in_different_records_or_objects_are_not_duplicates():
    content = b'[{"id":1,"left":{"ip":"first"},"right":{"ip":"second"}},{"id":2}]'
    assert parse_event_upload(content) == [
        {'id': 1, 'left': {'ip': 'first'}, 'right': {'ip': 'second'}}, {'id': 2}]


def test_distinct_case_and_unicode_keys_remain_distinct():
    assert parse_event_upload('{"Key":1,"key":2,"é":3,"é":4}'.encode()) == [
        {'Key': 1, 'key': 2, 'é': 3, 'é': 4}]
