"""Exact anchor-derived recorded-field equality and bounded UTC telemetry window."""
from datetime import UTC, datetime, timedelta

import pytest
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.security_event import SecurityEvent
from backend.models.user import User

STAMP = datetime(2026, 11, 1, 12, tzinfo=UTC)


def test_anchor_derived_literal_same_field_match_and_stable_complete_pages(client):
    headers = _register_and_login(client, 'neighbor-owner@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, domain='100%_safe.example')
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    with _TestingSessionLocal() as db:
        db.add_all(SecurityEvent(user_id=owner, timestamp=STAMP, event_type='dns', domain='100%_safe.example',
                                raw_data={'excluded': 'private payload'}) for _ in range(25))
        db.add_all([SecurityEvent(user_id=owner, timestamp=STAMP, event_type='dns', domain='100xxsafe.example'),
                    SecurityEvent(user_id=owner, timestamp=STAMP, event_type='dns', domain='100%_SAFE.example'),
                    SecurityEvent(user_id=owner, timestamp=STAMP, event_type='dns', hostname='100%_safe.example')])
        db.commit()
    path = f'/api/v1/events/{anchor}/recorded-neighbors'
    pages = [client.get(path, headers=headers, params={'field': 'domain', 'hours': 1, 'page': page}).json()
             for page in (1, 2, 3)]
    assert [len(page['records']) for page in pages] == [10, 10, 5]
    ids = [row['id'] for page in pages for row in page['records']]
    assert len(set(ids)) == 25 and ids == sorted(ids) and anchor not in ids
    assert all(page['total'] == 25 and page['value'] == '100%_safe.example' for page in pages)
    assert 'raw_data' not in str(pages) and 'private payload' not in str(pages) and 'user_id' not in str(pages)
    assert pages[0]['started_at'].startswith('2026-11-01T11:00:00')
    assert pages[0]['ended_before'].startswith('2026-11-01T13:00:00')


def test_inclusive_start_exclusive_end_and_no_cross_field_ip_inference(client):
    headers = _register_and_login(client, 'neighbor-bounds@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, source_ip='10.0.0.1')
    start = _make_event(client, headers, timestamp=STAMP - timedelta(hours=1), source_ip='10.0.0.1')
    _make_event(client, headers, timestamp=STAMP + timedelta(hours=1), source_ip='10.0.0.1')
    _make_event(client, headers, timestamp=STAMP, dest_ip='10.0.0.1')
    data = client.get(f'/api/v1/events/{anchor}/recorded-neighbors', headers=headers,
                      params={'field': 'source_ip', 'hours': 1}).json()
    assert data['total'] == 1 and data['records'][0]['id'] == start
    assert client.get(f'/api/v1/events/{anchor}/recorded-neighbors', headers=headers,
                      params={'field': 'source_ip', 'hours': 1, 'page': 999}).json()['records'] == []


def test_current_anchor_value_is_derived_again_without_inventing_missing_identity(client):
    headers = _register_and_login(client, 'neighbor-changed@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, username=' User ')
    matching = _make_event(client, headers, timestamp=STAMP, username=' User ')
    _make_event(client, headers, timestamp=STAMP, username='User')
    path = f'/api/v1/events/{anchor}/recorded-neighbors'
    data = client.get(path, headers=headers, params={'field': 'username'}).json()
    assert data['value'] == ' User ' and [row['id'] for row in data['records']] == [matching]
    with _TestingSessionLocal() as db:
        db.get(SecurityEvent, anchor).username = 'different'
        db.commit()
    changed = client.get(path, headers=headers, params={'field': 'username'}).json()
    assert changed['value'] == 'different' and changed['total'] == 0
    assert client.get(path, headers=headers, params={'field': 'hostname'}).status_code == 422


@pytest.mark.parametrize('params', [{}, {'field': 'url'}, {'field': 'domain', 'hours': 0},
    {'field': 'domain', 'hours': 169}, {'field': 'domain', 'page': 0}, {'field': 'domain', 'size': 101},
    {'field': 'domain', 'page': 999999999999999999999999}])
def test_invalid_scope(client, params):
    headers = _register_and_login(client, 'neighbor-invalid@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, domain='example.test')
    assert client.get(f'/api/v1/events/{anchor}/recorded-neighbors', headers=headers, params=params).status_code == 422


def test_foreign_admin_missing_and_inactive_anchor_do_not_disclose(client):
    headers = _register_and_login(client, 'neighbor-private-owner@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, hostname='private-host')
    _make_event(client, headers, timestamp=STAMP, hostname='private-host')
    other = _register_and_login(client, 'neighbor-other@example.com')
    own = _make_event(client, other, timestamp=STAMP, hostname='private-host')
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'neighbor-other@example.com').one().role = 'admin'
        db.commit()
    for identity in [anchor, 999999]:
        assert client.get(f'/api/v1/events/{identity}/recorded-neighbors', headers=other,
                          params={'field': 'hostname'}).status_code == 404
    assert client.get(f'/api/v1/events/{own}/recorded-neighbors', headers=other,
                      params={'field': 'hostname'}).json()['total'] == 0
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'neighbor-other@example.com').one().is_active = False
        db.commit()
    assert client.get(f'/api/v1/events/{own}/recorded-neighbors', headers=other,
                      params={'field': 'hostname'}).status_code == 403
    client.cookies.clear()
    assert client.get(f'/api/v1/events/{anchor}/recorded-neighbors', params={'field': 'hostname'}).status_code == 401


@pytest.mark.parametrize('field', ['source_ip', 'dest_ip', 'hostname', 'username', 'domain'])
def test_each_supported_anchor_field_matches_only_current_owner(client, field):
    headers = _register_and_login(client, 'neighbor-fields@example.com')
    anchor = _make_event(client, headers, timestamp=STAMP, **{field: 'literal'})
    match = _make_event(client, headers, timestamp=STAMP, **{field: 'literal'})
    other = _register_and_login(client, 'neighbor-field-other@example.com')
    _make_event(client, other, timestamp=STAMP, **{field: 'literal'})
    result = client.get(f'/api/v1/events/{anchor}/recorded-neighbors', headers=headers,
                        params={'field': field}).json()
    assert result['total'] == 1 and [row['id'] for row in result['records']] == [match]


def test_timestamp_window_overflow_is_explained_without_server_error(client):
    headers = _register_and_login(client, 'neighbor-overflow@example.com')
    anchor = _make_event(client, headers, timestamp=datetime(1, 1, 1, tzinfo=UTC), domain='literal')
    result = client.get(f'/api/v1/events/{anchor}/recorded-neighbors', headers=headers,
                        params={'field': 'domain', 'hours': 1})
    assert result.status_code == 422 and 'timestamp' in result.text
