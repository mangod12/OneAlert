"""Current event comparison never reexecutes a hunt or silently replaces loaded evidence."""
from copy import deepcopy
from datetime import UTC, datetime

import pytest
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.detection_rule import HuntSession
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_current_user
from backend.services.hunt_retained_review import (
    field_comparisons,
    retained_fingerprint,
    selected_retained_row,
    value_evidence,
)

COLUMNS = ['id', 'timestamp', 'severity', 'source_ip', 'dest_port', 'signature', 'bytes_in']


def seed(ledger):
    client, owner, other, _, sessions = ledger
    with sessions() as db:
        event = SecurityEvent(user_id=owner.id, timestamp=datetime(2026, 11, 1, tzinfo=UTC), event_type='alert',
                              severity='custom', source_ip='192.0.2.1', dest_port=0,
                              signature='X' * 1000 + 'current tail', bytes_in=9007199254740993,
                              raw_data={'private': 'NOT-RETURNED'})
        foreign = SecurityEvent(user_id=other.id, timestamp=datetime(2026, 11, 1, tzinfo=UTC), event_type='dns',
                                signature='PRIVATE-FOREIGN')
        db.add_all([event, foreign])
        db.flush()
        row = {'id': event.id, 'timestamp': '2026-11-01T00:00:00', 'severity': None, 'source_ip': '',
               'dest_port': 0, 'signature': 'X' * 1000 + 'saved tail', 'bytes_in': 9007199254740993}
        query = {'outcome': 'completed', 'execution': {'contract': 'scoped_select_v1',
                  'selected_columns': COLUMNS}, 'rows': [row], 'query': {'sql': 'Saved original query text'}}
        foreign_query = deepcopy(query)
        foreign_query['rows'][0]['id'] = foreign.id
        session = HuntSession(user_id=owner.id, hypothesis='Saved hypothesis, not a confirmed threat',
                              status='completed', queries_run=2, findings_count=2,
                              result_data={'query_results': [query, foreign_query]})
        db.add(session)
        db.commit()
        source = client.get(f'/api/v1/hunt/{session.id}').json()
        return session.id, event.id, foreign.id, source['retained_evidence_fingerprint']


def url(session, query=1, row=1):
    return f'/api/v1/hunt/{session}/queries/{query}/retained-rows/{row}/current-evidence'


def test_exact_saved_row_compares_only_selected_values_with_full_value_equality_and_exact_integers(ledger):
    session, event, _, token = seed(ledger)
    response = ledger[0].get(url(session), params={'fingerprint': token, 'expected_event_id': event})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['current_available'] and data['event_id'] == event and data['fingerprint'] == token
    fields = {field['name']: field for field in data['fields']}
    assert list(fields) == COLUMNS and data['field_count'] == len(COLUMNS)
    assert sum(not field['equal'] for field in fields.values()) == 3
    assert fields['severity']['retained']['kind'] == 'null'
    assert fields['source_ip']['retained']['text'] == ''
    assert fields['dest_port']['retained'] == {'kind': 'integer', 'text': '0', 'shortened': False}
    assert fields['bytes_in']['current']['text'] == '9007199254740993' and fields['bytes_in']['equal']
    signature = fields['signature']
    assert signature['retained'] == signature['current']
    assert signature['retained']['shortened'] and not signature['equal']
    assert 'NOT-RETURNED' not in str(data) and 'raw_data' not in str(data) and 'PRIVATE-FOREIGN' not in str(data)
    with ledger[-1]() as db:
        assert db.query(SecurityEvent).count() == 2 and db.query(HuntSession).count() == 1


def test_missing_and_foreign_current_ids_are_unavailable_without_disclosure_or_deletion_claim(ledger):
    session, event, foreign, token = seed(ledger)
    hidden = ledger[0].get(url(session, query=2), params={'fingerprint': token, 'expected_event_id': foreign}).json()
    with ledger[-1]() as db:
        db.delete(db.get(SecurityEvent, event))
        db.commit()
    missing = ledger[0].get(url(session), params={'fingerprint': token, 'expected_event_id': event}).json()
    assert hidden['current_available'] is missing['current_available'] is False
    assert hidden['fields'] == missing['fields'] == []
    assert 'PRIVATE-FOREIGN' not in str(hidden)


@pytest.mark.parametrize('what', ['hypothesis', 'row', 'context'])
def test_old_fingerprint_refuses_replacement_saved_evidence_before_current_lookup(ledger, what):
    session, event, _, token = seed(ledger)
    with ledger[-1]() as db:
        record = db.get(HuntSession, session)
        if what == 'hypothesis':
            record.hypothesis = 'Changed saved hypothesis'
        else:
            data = deepcopy(record.result_data)
            if what == 'row':
                data['query_results'][0]['rows'][0]['source_ip'] = 'changed'
            else:
                data['query_results'][0]['query']['sql'] = 'Different query context'
            record.result_data = data
        db.commit()
    assert ledger[0].get(url(session), params={'fingerprint': token, 'expected_event_id': event}).status_code == 409


def test_wrong_loaded_event_id_and_foreign_admin_session_cannot_substitute_scope(ledger):
    session, event, _, token = seed(ledger)
    client, owner, other, _, _ = ledger
    params = {'fingerprint': token, 'expected_event_id': event + 99}
    assert client.get(url(session), params=params).status_code == 409
    other.role = 'admin'
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(url(session), params={**params, 'expected_event_id': event}).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert client.get(url(session), params=params).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get(url(session), params=params).status_code == 401


@pytest.mark.parametrize('change', [{'outcome': 'failed'}, {'execution': {}}, {'rows': []},
    {'execution': {'contract': 'scoped_select_v1', 'selected_columns': ['raw_data', 'id']}},
    {'execution': {'contract': 'scoped_select_v1', 'selected_columns': ['id', 'id']}},
    {'rows': [{'id': True}]}, {'rows': [{'id': 1, 'extra': 'unsupported'}]}])
def test_unsupported_saved_identity_and_field_contract_are_not_guessed(change):
    query = {'outcome': 'completed', 'execution': {'contract': 'scoped_select_v1', 'selected_columns': ['id']},
             'rows': [{'id': 1}]}
    with pytest.raises(ValueError):
        selected_retained_row({'query_results': [{**query, **change}]}, 1, 1)


def test_fingerprint_is_bounded_and_deterministic_without_dictionary_order_semantics():
    a = {'query_results': [{'rows': [{'id': 1, 'severity': None}]}]}
    b = {'query_results': [{'rows': [{'severity': None, 'id': 1}]}]}
    assert retained_fingerprint(7, 'same', a) == retained_fingerprint(7, 'same', b)
    assert retained_fingerprint(8, 'same', a) != retained_fingerprint(7, 'same', a)
    assert retained_fingerprint(7, 'same', None) is None
    assert retained_fingerprint(7, 'same', {'query_results': [{'text': 'X' * 2000001}]}) is None
    assert retained_fingerprint(7, 'same', {'query_results': [{'text': float('nan')}]}) is None


@pytest.mark.parametrize('value', [True, {}, [], 1.5, 2**63, -(2**63) - 1])
def test_unsupported_scalar_values_are_not_stringified_or_rounded(value):
    with pytest.raises(ValueError):
        value_evidence(value)


def test_scalar_types_null_empty_and_large_signed_integers_remain_distinct():
    fields = field_comparisons(['a', 'b', 'c'], {'a': None, 'b': '', 'c': 9007199254740993},
                              {'a': '', 'b': None, 'c': 9007199254740992})
    assert all(not field['equal'] for field in fields)
    assert fields[-1]['retained']['text'] != fields[-1]['current']['text']


def test_http_selector_and_fingerprint_bounds_reject_invalid_requests(ledger):
    session, event, _, token = seed(ledger)
    params = {'fingerprint': token, 'expected_event_id': event}
    for path in [url(0), url(session, query=0), url(session, query=4), url(session, row=0),
                 url(session, row=101), url(2147483648)]:
        assert ledger[0].get(path, params=params).status_code == 422
    for patch in [{'fingerprint': token.upper()}, {'fingerprint': token[:-1]},
                  {'fingerprint': 'z' * 64}, {'expected_event_id': 0}, {'expected_event_id': 2147483648}]:
        assert ledger[0].get(url(session), params={**params, **patch}).status_code == 422
    assert ledger[0].get(url(session), params={'fingerprint': token}).status_code == 422


def test_unicode_text_limit_and_signed_integer_extremes_are_exact():
    assert value_evidence('🛡' * 1001) == {'kind': 'text', 'text': '🛡' * 1000, 'shortened': True}
    for number in [-(2**63), 2**63 - 1]:
        assert value_evidence(number) == {'kind': 'integer', 'text': str(number), 'shortened': False}
