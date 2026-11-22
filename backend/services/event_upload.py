"""Strict file-envelope validation before creating event sources or records."""

import json
import zlib

from fastapi import HTTPException

MAX_UPLOAD_RECORDS = 50000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _reject_non_json_number(value):
    raise ValueError("Nonstandard JSON number")


def _unique_object(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            # A repeated field can silently replace security evidence. Never
            # echo the untrusted key or pick whichever occurrence came last.
            raise ValueError("Repeated JSON object field")
        record[key] = value
    return record


def _loads(text):
    return json.loads(text, parse_constant=_reject_non_json_number, object_pairs_hook=_unique_object)


def _validate_nesting(records):
    stack = [(iter(records), 0)]
    while stack:
        iterator, depth = stack[-1]
        try:
            value = next(iterator)
        except StopIteration:
            stack.pop()
            continue
        if isinstance(value, (dict, list)):
            if depth >= 64:
                raise HTTPException(status_code=400, detail="JSON nesting exceeds 64 levels")
            stack.append((iter(value.values() if isinstance(value, dict) else value), depth + 1))


def parse_event_upload(content: bytes, source_type: str | None = None) -> list[dict]:
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Event file exceeds the 10 MiB limit")
    if source_type == "aws_cloudtrail" and content.startswith(b"\x1f\x8b"):
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            expanded = decoder.decompress(content, MAX_UPLOAD_BYTES + 1)
        except zlib.error as exc:
            raise HTTPException(status_code=400, detail="CloudTrail gzip could not be decoded or verified") from exc
        if len(expanded) > MAX_UPLOAD_BYTES or decoder.unconsumed_tail:
            raise HTTPException(status_code=413, detail="Expanded event file exceeds the 10 MiB limit")
        if not decoder.eof or decoder.unused_data:
            raise HTTPException(status_code=400, detail="Gzip must be one complete member without trailing data")
        content = expanded
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Event file must be valid UTF-8 JSON") from exc
    try:
        document = _loads(text)
    except RecursionError as exc:
        raise HTTPException(status_code=400, detail="JSON nesting is too deep") from exc
    except ValueError:
        records = []
        for line_number, line in enumerate(text.split("\n"), 1):
            if not line.strip():
                continue
            try:
                record = _loads(line)
            except (ValueError, RecursionError) as exc:
                raise HTTPException(
                    status_code=400, detail=f"Invalid JSON on line {line_number}; no records imported"
                ) from exc
            if not isinstance(record, dict):
                raise HTTPException(status_code=400, detail=f"Line {line_number} must contain a JSON object") from None
            records.append(record)
            if len(records) > MAX_UPLOAD_RECORDS:
                raise HTTPException(status_code=400, detail="File limit is 50,000 JSON records") from None
    else:
        if source_type == "aws_cloudtrail" and isinstance(document, dict) and "Records" in document:
            if set(document) != {"Records"} or not isinstance(document["Records"], list):
                raise HTTPException(status_code=400, detail="CloudTrail envelope must contain only a Records array")
            records = document["Records"]
        else:
            records = document if isinstance(document, list) else [document]
        if len(records) > MAX_UPLOAD_RECORDS:
            raise HTTPException(status_code=400, detail="File limit is 50,000 JSON records")
        for index, record in enumerate(records, 1):
            if not isinstance(record, dict):
                raise HTTPException(status_code=400, detail=f"Record {index} must be a JSON object")
    if not records:
        raise HTTPException(status_code=400, detail="No JSON records found in file")
    _validate_nesting(records)
    return records
