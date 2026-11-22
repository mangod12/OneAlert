"""Exact source label scope never broadens missing, empty, wildcard or owner boundaries."""
from datetime import UTC, datetime

import pytest
from test_event_source_evidence import source_id
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.security_event import SecurityEvent
from backend.models.user import User


def test_literal_label_scope_complete_stable_pages_and_payload_exclusion(client):
    headers = _register_and_login(client, 'source-group@example.com')
    identity = source_id(client, headers)
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    stamp = datetime(2026, 1, 1, tzinfo=UTC)
    with _TestingSessionLocal() as db:
        db.add_all(SecurityEvent(user_id=owner, source_id=identity, timestamp=stamp, event_type='100%_literal',
                                raw_data={'private': 'HIDDEN PAYLOAD'}) for _ in range(23))
        db.add_all([SecurityEvent(user_id=owner, source_id=identity, timestamp=stamp, event_type='100xxliteral'),
                    SecurityEvent(user_id=owner, source_id=identity, timestamp=stamp, event_type='100%_LITERAL'),
                    SecurityEvent(user_id=owner, source_id=None, timestamp=stamp, event_type='100%_literal')])
        db.commit()
    path = f'/api/v1/events/sources/{identity}/group-events'
    pages = [client.get(path, headers=headers, params={'group': 'event_type', 'value': '100%_literal',
                                                      'page': page}).json() for page in (1, 2, 3)]
    assert [len(page['records']) for page in pages] == [10, 10, 3]
    ids = [row['id'] for page in pages for row in page['records']]
    assert len(set(ids)) == 23 and ids == sorted(ids, reverse=True)
    assert all(page['total'] == 23 and page['value'] == '100%_literal' for page in pages)
    assert 'HIDDEN PAYLOAD' not in str(pages) and 'raw_data' not in str(pages) and 'user_id' not in str(pages)


def test_missing_empty_and_unfamiliar_labels_remain_distinct(client):
    headers = _register_and_login(client, 'source-group-null@example.com')
    identity = source_id(client, headers)
    empty = _make_event(client, headers, source_id=identity, source_type='')
    missing = _make_event(client, headers, source_id=identity, source_type=None)
    path = f'/api/v1/events/sources/{identity}/group-events'
    blank = client.get(path, headers=headers, params={'group': 'source_type', 'value': ''}).json()
    absent = client.get(path, headers=headers, params={'group': 'source_type', 'missing': True}).json()
    assert blank['total'] == 1 and blank['records'][0]['id'] == empty and blank['value'] == ''
    assert absent['total'] == 1 and absent['records'][0]['id'] == missing and absent['value'] is None
    assert client.get(path, headers=headers, params={'group': 'severity', 'value': 'unknown'}).json()['total'] == 0


@pytest.mark.parametrize('group', ['severity', 'event_type', 'source_type', 'processed'])
def test_each_group_is_exact_and_ownership_never_widens(client, group):
    headers = _register_and_login(client, f'source-group-{group}@example.com')
    identity = source_id(client, headers)
    own = _make_event(client, headers, source_id=identity, **{group: 'literal'})
    other = _register_and_login(client, 'source-group-other@example.com')
    _make_event(client, other, source_id=identity, **{group: 'literal'})
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'source-group-other@example.com').one().role = 'admin'
        db.commit()
    path = f'/api/v1/events/sources/{identity}/group-events'
    result = client.get(path, headers=headers, params={'group': group, 'value': 'literal'}).json()
    assert result['total'] == 1 and result['records'][0]['id'] == own
    assert client.get(path, headers=other, params={'group': group, 'value': 'literal'}).status_code == 404


@pytest.mark.parametrize('params', [{'group': 'severity'}, {'group': 'severity', 'missing': True, 'value': ''},
    {'group': 'hostname', 'value': 'x'}, {'group': 'severity', 'value': 'x', 'page': 0},
    {'group': 'severity', 'value': 'x', 'page': 9999999999999999999999},
    {'group': 'severity', 'value': 'x', 'size': 101}])
def test_invalid_scope_is_refused(client, params):
    headers = _register_and_login(client, 'source-group-invalid@example.com')
    identity = source_id(client, headers)
    assert client.get(f'/api/v1/events/sources/{identity}/group-events',
                      headers=headers, params=params).status_code == 422


def test_inactive_anonymous_and_missing_sources_are_not_disclosed(client):
    headers = _register_and_login(client, 'source-group-auth@example.com')
    identity = source_id(client, headers)
    params = {'group': 'severity', 'value': 'high'}
    assert client.get('/api/v1/events/sources/999999/group-events',
                      headers=headers, params=params).status_code == 404
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'source-group-auth@example.com').one().is_active = False
        db.commit()
    path = f'/api/v1/events/sources/{identity}/group-events'
    assert client.get(path, headers=headers, params=params).status_code == 403
    client.cookies.clear()
    assert client.get(path, params=params).status_code == 401
