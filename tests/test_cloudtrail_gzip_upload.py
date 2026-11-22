"""Native CloudTrail gzip is byte-bound and expansion-bounded before any writes."""

import gzip
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from test_agent_run_detail import ledger as ledger
from test_aws_cloudtrail_ingestion import record

from backend.models.security_event import EventSource, SecurityEvent
from backend.services.event_parser_preview import event_preview_fingerprint, preview_event_file
from backend.services.event_upload import MAX_UPLOAD_BYTES, parse_event_upload


def packed(records=None):
    return gzip.compress(json.dumps({"Records": records if records is not None else [record()]}).encode(), mtime=0)


def test_native_gzip_counts_and_redaction_match_plain_json_but_fingerprint_binds_original_bytes():
    compressed = packed()
    plain = gzip.decompress(compressed)
    zipped, unzipped = [preview_event_file(data, "aws_cloudtrail") for data in [compressed, plain]]
    for key in ["received", "accepted", "skipped", "redactions_in_accepted", "skip_reasons", "skipped_positions"]:
        assert zipped[key] == unzipped[key]
    assert zipped["accepted"] == 1
    assert zipped["byte_size"] == len(compressed)
    assert zipped["fingerprint"] == event_preview_fingerprint(compressed, "aws_cloudtrail")
    assert zipped["fingerprint"] != unzipped["fingerprint"]
    assert "private-person" not in json.dumps(zipped)


@pytest.mark.parametrize("source", [None, "suricata", "zeek", "linux_journal", "windows_security"])
def test_gzip_is_not_guessed_for_other_parsers(source):
    with pytest.raises(HTTPException):
        parse_event_upload(packed(), source)


@pytest.mark.parametrize(
    "mode", ["truncated", "header_only", "crc", "length", "trailing", "zero_padding", "concatenated"]
)
def test_corrupt_incomplete_or_multimember_stream_is_rejected_whole(mode):
    body = packed()
    if mode == "truncated":
        body = body[:-1]
    elif mode == "header_only":
        body = body[:10]
    elif mode == "crc":
        body = body[:-8] + bytes([body[-8] ^ 1]) + body[-7:]
    elif mode == "length":
        body = body[:-1] + bytes([body[-1] ^ 1])
    elif mode == "trailing":
        body += b"private trailing bytes"
    elif mode == "zero_padding":
        body += b"\0"
    else:
        body += gzip.compress(b"", mtime=0)
    with pytest.raises(HTTPException) as error:
        parse_event_upload(body, "aws_cloudtrail")
    assert error.value.status_code == 400
    assert "private" not in error.value.detail


def test_original_and_expanded_byte_limits_are_enforced_before_parsing():
    with pytest.raises(HTTPException) as error:
        parse_event_upload(b" " * (MAX_UPLOAD_BYTES + 1), "aws_cloudtrail")
    assert error.value.status_code == 413
    bomb = gzip.compress(b" " * (MAX_UPLOAD_BYTES + 1), mtime=0)
    assert len(bomb) < 20000
    with pytest.raises(HTTPException) as error:
        parse_event_upload(bomb, "aws_cloudtrail")
    assert error.value.status_code == 413


@pytest.mark.parametrize(
    "text",
    [b'{"Records":[{"x":1,"x":2}]}', b'{"Records":[{"x":NaN}]}', b'{"Records":[null]}', b'{"Records":[]}', b"\xff"],
)
def test_expanded_content_still_uses_strict_json_and_whole_envelope_validation(text):
    with pytest.raises(HTTPException):
        parse_event_upload(gzip.compress(text, mtime=0), "aws_cloudtrail")


def test_expanded_record_and_nesting_limits_remain_active():
    assert len(parse_event_upload(packed([{}] * 50000), "aws_cloudtrail")) == 50000
    with pytest.raises(HTTPException):
        parse_event_upload(packed([{}] * 50001), "aws_cloudtrail")
    deep = b'{"Records":[' + b'{"x":' * 64 + b"{}" + b"}" * 64 + b"]}"
    with pytest.raises(HTTPException):
        parse_event_upload(gzip.compress(deep, mtime=0), "aws_cloudtrail")


def test_single_bom_and_flat_json_shapes_remain_accepted_after_expansion():
    raw = record()
    for body in [json.dumps(raw), json.dumps([raw]), json.dumps(raw) + "\n" + json.dumps(raw)]:
        plain = b"\xef\xbb\xbf" + body.encode()
        assert parse_event_upload(gzip.compress(plain, mtime=0), "aws_cloudtrail") == parse_event_upload(
            plain, "aws_cloudtrail"
        )


def test_bound_http_preview_import_and_recompressed_mismatch_use_original_gzip_bytes(ledger):
    client = ledger[0]
    good = record()
    bad = record()
    bad["eventTime"] = "bad"
    body = packed([good, bad])
    params = {"source_type": "aws_cloudtrail"}
    preview = client.post("/api/v1/events/upload/preview", params=params, files={"file": ("native.json.gz", body)})
    assert preview.status_code == 200, preview.text
    data = preview.json()["data"]
    assert (data["received"], data["accepted"], data["skipped"]) == (2, 1, 1)
    assert data["byte_size"] == len(body)
    with ledger[-1]() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []
    recompressed = gzip.compress(gzip.decompress(body), mtime=1)
    assert recompressed != body
    for changed in [recompressed, gzip.decompress(body)]:
        refused = client.post(
            "/api/v1/events/upload",
            params={**params, "preview_fingerprint": data["fingerprint"]},
            files={"file": ("native.json.gz", changed)},
        )
        assert refused.status_code == 409
    imported = client.post(
        "/api/v1/events/upload",
        params={**params, "preview_fingerprint": data["fingerprint"]},
        files={"file": ("native.json.gz", body)},
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["data"]["ingested"] == 1
    with ledger[-1]() as db:
        event = db.execute(select(SecurityEvent)).scalar_one()
        assert event.user_id == ledger[1].id and event.source_type == "aws_cloudtrail"
        assert event.raw_data["requestParameters"]["note"] == "[REDACTED_EMAIL]"


def test_invalid_gzip_http_attempts_create_no_sources_or_events(ledger):
    for body in [packed()[:-1], packed() + b"junk", gzip.compress(b" " * (MAX_UPLOAD_BYTES + 1), mtime=0)]:
        for suffix in ["/preview", ""]:
            response = ledger[0].post(
                "/api/v1/events/upload" + suffix,
                params={"source_type": "aws_cloudtrail"},
                files={"file": ("bad.json.gz", body)},
            )
            assert response.status_code in {400, 413}
    with ledger[-1]() as db:
        assert db.execute(select(EventSource)).scalars().all() == []
        assert db.execute(select(SecurityEvent)).scalars().all() == []


def test_exact_expanded_byte_limit_is_inclusive():
    plain = json.dumps({"Records": [record()]}).encode()
    padded = plain + b" " * (MAX_UPLOAD_BYTES - len(plain))
    assert len(padded) == MAX_UPLOAD_BYTES
    assert len(parse_event_upload(gzip.compress(padded, mtime=0), "aws_cloudtrail")) == 1
