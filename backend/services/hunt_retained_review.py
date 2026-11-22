"""Bind current event lookups to the exact saved hunt evidence the analyst read."""
import hashlib
import json
from datetime import datetime

from backend.services.agents.hunt import ALLOWED_HUNT_COLUMNS


def retained_fingerprint(session_id, hypothesis, data):
    queries = data.get('query_results') if isinstance(data, dict) else data
    if not isinstance(queries, list) or not 1 <= len(queries) <= 3:
        return None
    try:
        raw = json.dumps({'session_id': session_id, 'hypothesis': hypothesis, 'queries': queries},
                         ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(',', ':'))
        if len(raw) > 2000000:
            return None
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()
    except (ValueError, TypeError, RecursionError):
        return None


def selected_retained_row(data, query_number, row_number):
    queries = data.get('query_results') if isinstance(data, dict) else data
    if not isinstance(queries, list) or not 1 <= query_number <= len(queries) <= 3:
        raise ValueError('Saved query selection is unsupported')
    query = queries[query_number - 1]
    if not isinstance(query, dict) or query.get('outcome') != 'completed':
        raise ValueError('The saved query has no supported completed execution')
    execution, rows = query.get('execution'), query.get('rows')
    if not isinstance(execution, dict) or execution.get('contract') != 'scoped_select_v1':
        raise ValueError('The saved query has no supported event-column contract')
    columns = execution.get('selected_columns')
    if (not isinstance(columns, list) or not 1 <= len(columns) <= len(ALLOWED_HUNT_COLUMNS)
            or any(not isinstance(name, str) or name not in ALLOWED_HUNT_COLUMNS for name in columns)
            or len(set(columns)) != len(columns) or 'id' not in columns
            or not isinstance(rows, list) or not 1 <= row_number <= len(rows) <= 100):
        raise ValueError('Saved event columns or retained row position are unsupported')
    row = rows[row_number - 1]
    if (not isinstance(row, dict) or set(row) != set(columns)
            or type(row.get('id')) is not int or not 1 <= row['id'] <= 2147483647):
        raise ValueError('The saved row has no supported exact event ID and field set')
    for value in row.values():
        value_evidence(value)
    return columns, row


def value_evidence(value):
    """Exact integers stay decimal text, including those outside JavaScript's safe range."""
    if isinstance(value, datetime):
        value = value.isoformat()
    if value is None:
        return {'kind': 'null', 'text': None, 'shortened': False}
    if type(value) is int:
        if not -(2**63) <= value < 2**63:
            raise ValueError('A retained integer is outside the supported event field range')
        return {'kind': 'integer', 'text': str(value), 'shortened': False}
    if isinstance(value, str):
        return {'kind': 'text', 'text': value[:1000], 'shortened': len(value) > 1000}
    raise ValueError('A saved or current field value has an unsupported scalar type')


def field_comparisons(columns, retained, current):
    fields = []
    for name in columns:
        before, after = retained[name], current[name]
        if isinstance(after, datetime):
            after = after.isoformat()
        fields.append({'name': name, 'retained': value_evidence(before), 'current': value_evidence(after),
                       'equal': type(before) is type(after) and before == after})
    return fields
