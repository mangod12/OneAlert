"""Workspace event search is bounded, literal, stable and owned, not a raw-payload query."""
from datetime import UTC, datetime

import pytest
from test_search import TestingSessionLocal
from test_search import auth_headers as auth_headers
from test_search import client as client

from backend.models.security_event import SecurityEvent
from backend.models.user import User


def seed():
    with TestingSessionLocal() as db:
        owner = db.query(User).first().id
        for _ in range(7):
            db.add(SecurityEvent(user_id=owner, timestamp=datetime(2026, 11, 1, tzinfo=UTC),
                                 event_type='alert', signature='Gateway 100%_ notice', hostname='plant-host',
                                 source_ip='10.0.0.7', dest_ip='10.0.0.8',
                                 signature_id='SID-7700', category='Network check',
                                 raw_data={'unsearched': 'private raw payload text'}))
        db.add(SecurityEvent(user_id=999, timestamp=datetime(2026, 11, 1, tzinfo=UTC),
                             event_type='alert', signature='Private Gateway 100%_'))
        db.commit()
        return max(row.id for row in db.query(SecurityEvent).filter(SecurityEvent.user_id == owner))


@pytest.mark.parametrize('query', ['100%_', 'plant-host', '10.0.0.7', '10.0.0.8', 'SID-7700', 'Network check'])
def test_full_owned_event_fields_search_bounded_and_stable(client, auth_headers, query):
    newest = seed()
    data = client.get('/api/v1/search/', headers=auth_headers, params={'q': query}).json()['data']
    assert len(data['events']) == 5
    assert [event['id'] for event in data['events']] == list(range(newest, newest - 5, -1))
    assert all('raw_data' not in event and 'user_id' not in event for event in data['events'])
    assert 'Private Gateway' not in str(data)


def test_exact_event_id_and_query_echo_and_no_raw_payload_search(client, auth_headers):
    newest = seed()
    # Ensure the record-ID query has at least two characters without relying on fixture ID count.
    with TestingSessionLocal() as db:
        row = db.get(SecurityEvent, newest)
        row.id = 90909
        db.commit()
    data = client.get('/api/v1/search/', headers=auth_headers, params={'q': ' 90909 '}).json()['data']
    assert data['query'] == '90909' and data['events'][0]['id'] == 90909
    for query in ['private raw payload text', '100ZZnotice', 'Private Gateway', chr(92) * 2, 'unmatched phrase']:
        assert client.get('/api/v1/search/', headers=auth_headers, params={'q': query}).json()['data']['events'] == []


@pytest.mark.parametrize('query', ['  ', ' x ', 'x' * 201])
def test_padding_and_oversized_queries_cannot_browse_all_events(client, auth_headers, query):
    assert client.get('/api/v1/search/', headers=auth_headers, params={'q': query}).status_code == 422
