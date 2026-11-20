"""Exact event reads preserve stored values and never disclose another owner's source metadata."""
import json

from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.security_event import EventSource


def test_exact_record_precision_empty_payload_and_read_only(client):
    headers = _register_and_login(client, 'exact-event@example.com')
    identity = _make_event(client, headers, bytes_in=9007199254740993, bytes_out=0, source_port=0,
                           raw_data={'counter': 9007199254740993, 'empty': None, 'zero': 0})
    response = client.get(f'/api/v1/events/{identity}/evidence', headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data['event']['id'] == identity
    assert data['event']['bytes_in'] == '9007199254740993' and data['event']['bytes_out'] == '0'
    assert data['event']['source_port'] == 0
    assert '9007199254740993' in data['raw_payload_json']
    assert json.loads(data['raw_payload_json']) == {'counter': 9007199254740993, 'empty': None, 'zero': 0}
    assert 'user_id' not in data['event'] and 'raw_data' not in data['event']
    assert data['source_state'] == 'not_linked' and data['source'] is None
    again = client.get(f'/api/v1/events/{identity}/evidence', headers=headers).json()
    assert again['event'] == data['event'] and again['raw_payload_json'] == data['raw_payload_json']
    empty = _make_event(client, headers, raw_data={})
    assert client.get(f'/api/v1/events/{empty}/evidence', headers=headers).json()['raw_payload_json'] == '{}'


def test_missing_payload_and_counters_are_not_zero(client):
    headers = _register_and_login(client, 'missing-event-fields@example.com')
    identity = _make_event(client, headers)
    data = client.get(f'/api/v1/events/{identity}/evidence', headers=headers).json()
    assert data['raw_payload_json'] is None
    assert data['event']['bytes_in'] is None and data['event']['bytes_out'] is None


def test_owned_source_metadata_is_separate_and_foreign_source_is_hidden(client):
    headers = _register_and_login(client, 'owned-event-source@example.com')
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    with _TestingSessionLocal() as db:
        own = EventSource(user_id=owner, name='Owned gateway', source_type='suricata', status='active')
        foreign = EventSource(user_id=999, name='Private foreign gateway', source_type='private-source')
        db.add_all([own, foreign])
        db.commit()
        own_id, foreign_id = own.id, foreign.id
    for source_id, state in [(own_id, 'owned'), (foreign_id, 'unavailable'), (999999, 'unavailable')]:
        identity = _make_event(client, headers, source_id=source_id, source_type='recorded-event-type')
        data = client.get(f'/api/v1/events/{identity}/evidence', headers=headers).json()
        assert data['source_state'] == state and data['event']['source_type'] == 'recorded-event-type'
        if state == 'owned':
            assert data['source']['id'] == own_id and data['source']['source_type'] == 'suricata'
            assert 'user_id' not in data['source']
        else:
            assert data['source'] is None and 'Private foreign gateway' not in str(data)


def test_foreign_missing_and_anonymous_records_are_not_disclosed(client):
    own = _register_and_login(client, 'event-owner@example.com')
    other = _register_and_login(client, 'event-other@example.com')
    identity = _make_event(client, own, signature='Private saved signature')
    for value in [identity, 999999]:
        assert client.get(f'/api/v1/events/{value}/evidence', headers=other).status_code == 404
    client.cookies.clear()
    assert client.get(f'/api/v1/events/{identity}/evidence').status_code in (401, 403)
