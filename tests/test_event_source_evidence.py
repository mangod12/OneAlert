"""Owned source profiles separate stored counters from retained telemetry coverage."""
from datetime import UTC, datetime

from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.security_event import EventSource, SecurityEvent
from backend.models.user import User


def source_id(client, headers, **kwargs):
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    with _TestingSessionLocal() as db:
        source = EventSource(user_id=owner, name='Saved gateway', source_type='suricata', event_count=99, **kwargs)
        db.add(source)
        db.commit()
        return source.id


def test_complete_retained_counts_and_unknown_labels_without_claiming_health(client):
    headers = _register_and_login(client, 'source-evidence@example.com')
    identity = source_id(client, headers, status='active', last_event_at=datetime(2030, 1, 1, tzinfo=UTC))
    _make_event(client, headers, source_id=identity, timestamp=datetime(2026, 1, 1, tzinfo=UTC),
                source_ip='10.0.0.1', hostname='   ', severity='custom', processed='pending',
                raw_data={'private': 'not in profile'})
    _make_event(client, headers, source_id=identity, timestamp=datetime(2026, 2, 1, tzinfo=UTC),
                source_ip='', hostname=' gateway ', domain='example.test', severity='high', processed='in_case')
    _make_event(client, headers, source_id=None, source_ip='10.0.0.2')
    other = _register_and_login(client, 'source-evidence-other@example.com')
    _make_event(client, other, source_id=identity, username='private-user')
    response = client.get(f'/api/v1/events/sources/{identity}/recorded-evidence', headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data['source']['event_count'] == 99 and data['retained_event_count'] == 2
    assert data['source']['last_event_at'].startswith('2030')
    assert data['first_observed_at'].startswith('2026-01-01')
    assert data['last_observed_at'].startswith('2026-02-01')
    assert data['nonempty_field_counts'] == {'source_ip': 1, 'dest_ip': 0, 'hostname': 1, 'username': 0, 'domain': 1}
    assert data['groups']['severity'] == [{'value': 'custom', 'count': 1}, {'value': 'high', 'count': 1}]
    assert data['groups']['source_type'] == [{'value': None, 'count': 2}]
    assert sum(row['count'] for row in data['groups']['processed']) == 2
    assert 'private-user' not in str(data) and 'not in profile' not in str(data) and 'user_id' not in data['source']


def test_empty_source_has_missing_spans_not_false_zero_dates(client):
    headers = _register_and_login(client, 'source-empty@example.com')
    identity = source_id(client, headers)
    data = client.get(f'/api/v1/events/sources/{identity}/recorded-evidence', headers=headers).json()
    assert data['retained_event_count'] == 0
    assert all(data[key] is None for key in ['first_observed_at', 'last_observed_at',
                                           'first_created_at', 'last_created_at'])
    assert all(value == 0 for value in data['nonempty_field_counts'].values())
    assert all(rows == [] for rows in data['groups'].values())


def test_owner_only_even_for_admin_and_inactive(client):
    headers = _register_and_login(client, 'source-private@example.com')
    identity = source_id(client, headers)
    other = _register_and_login(client, 'source-admin@example.com')
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'source-admin@example.com').one().role = 'admin'
        db.commit()
    path = f'/api/v1/events/sources/{identity}/recorded-evidence'
    assert client.get(path, headers=other).status_code == 404
    assert client.get('/api/v1/events/sources/999999/recorded-evidence', headers=headers).status_code == 404
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'source-private@example.com').one().is_active = False
        db.commit()
    assert client.get(path, headers=headers).status_code == 403
    client.cookies.clear()
    assert client.get(path).status_code == 401


def test_too_many_group_labels_refuses_instead_of_silent_truncation(client):
    headers = _register_and_login(client, 'source-group-bound@example.com')
    identity = source_id(client, headers)
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    with _TestingSessionLocal() as db:
        db.add_all(SecurityEvent(user_id=owner, source_id=identity, timestamp=datetime(2026, 1, 1, tzinfo=UTC),
                                event_type=f'kind-{i}') for i in range(1001))
        db.commit()
    response = client.get(f'/api/v1/events/sources/{identity}/recorded-evidence', headers=headers)
    assert response.status_code == 422 and 'No partial profile' in response.text
