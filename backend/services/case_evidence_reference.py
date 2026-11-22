"""Strict parsing of supported saved analyst source references."""
import re
from datetime import datetime

from fastapi import HTTPException

FIELDS = ('label_at_review', 'label_truncated', 'severity', 'recorded_at', 'processing_label')


def saved_note_reference(entry, case_id):
    metadata = entry.metadata_json
    valid = (entry.entry_type == 'note' and entry.source == 'human' and isinstance(metadata, dict)
             and metadata.get('kind') == 'reviewed_evidence_note'
             and type(metadata.get('schema_version')) is int and metadata['schema_version'] == 1
             and type(metadata.get('case_id')) is int and metadata['case_id'] == case_id
             and metadata.get('record_kind') in ('alert', 'event')
             and type(metadata.get('record_id')) is int and 0 < metadata['record_id'] <= 9007199254740991)
    if valid:
        valid = all(isinstance(metadata.get(key), str) and re.fullmatch('[a-f0-9]{64}', metadata[key])
                    for key in ('record_fingerprint', 'reviewed_fingerprint'))
    snapshot = metadata.get('record_snapshot') if valid else None
    valid = (valid and isinstance(snapshot, dict) and isinstance(snapshot.get('label_at_review'), str)
             and len(snapshot['label_at_review']) <= 500 and type(snapshot.get('label_truncated')) is bool
             and all(key in snapshot and (snapshot[key] is None or isinstance(snapshot[key], str))
                     for key in ('severity', 'recorded_at', 'processing_label')))
    if valid and snapshot['recorded_at'] is not None:
        try:
            datetime.fromisoformat(snapshot['recorded_at'].replace('Z', '+00:00'))
        except ValueError:
            valid = False
    if not valid:
        raise HTTPException(status_code=422, detail='This note has no supported, complete saved source reference')
    return metadata['record_kind'], metadata['record_id'], metadata['record_fingerprint'], {
        key: snapshot[key] for key in FIELDS}
