"""Owned UTC observation distributions and exact bucket records, including empty buckets."""
from datetime import UTC, datetime, timedelta

import pytest
from test_event_source_evidence import source_id
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.security_event import SecurityEvent
from backend.models.user import User

START = datetime(2026, 11, 1, tzinfo=UTC)
PARAMS = {'started_at': START.isoformat(), 'ended_before': (START + timedelta(days=1)).isoformat()}


def test_aligned_buckets_include_zeros_and_boundaries_without_payloads(client):
    h = _register_and_login(client, 'time-owner@example.com')
    identity = source_id(client, h)
    for hour in [0, 0, 2, 23, 24, -1]:
        _make_event(client, h, source_id=identity, timestamp=START + timedelta(hours=hour),
                    raw_data={'private': 'EXCLUDED'})
    _make_event(client, h, timestamp=START)
    data = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h, params=PARAMS).json()
    assert data['total'] == 4 and len(data['buckets']) == 24
    assert [row['count'] for row in data['buckets']][:4] == [2, 0, 1, 0]
    assert data['buckets'][-1]['count'] == 1
    assert 'EXCLUDED' not in str(data) and 'raw_data' not in str(data)
    six = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h,
                     params={**PARAMS, 'bucket_hours': 6}).json()
    assert [row['count'] for row in six['buckets']] == [3, 0, 0, 1]
    day = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h,
                     params={**PARAMS, 'bucket_hours': 24}).json()
    assert [row['count'] for row in day['buckets']] == [4]


def test_offset_normalizes_to_same_utc_window_and_empty_is_explicit(client):
    h = _register_and_login(client, 'time-offset@example.com')
    identity = source_id(client, h)
    data = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h,
        params={'started_at': '2026-11-01T05:30:00+05:30', 'ended_before': '2026-11-02T05:30:00+05:30'}).json()
    assert data['total'] == 0 and len(data['buckets']) == 24
    assert all(row['count'] == 0 for row in data['buckets'])
    assert data['started_at'].startswith('2026-11-01T00:00:00')


def test_exact_window_pages_stable_and_owner_scoped(client):
    h = _register_and_login(client, 'time-pages@example.com')
    identity = source_id(client, h)
    owner = client.get('/api/v1/auth/me', headers=h).json()['id']
    with _TestingSessionLocal() as db:
        db.add_all(SecurityEvent(user_id=owner, source_id=identity, timestamp=START, event_type='dns',
                                raw_data={'private': 'EXCLUDED'}) for _ in range(23))
        db.commit()
    other = _register_and_login(client, 'time-other@example.com')
    _make_event(client, other, source_id=identity, timestamp=START)
    path = f'/api/v1/events/sources/{identity}/recorded-window-events'
    pages = [client.get(path, headers=h, params={**PARAMS, 'page': p}).json() for p in [1, 2, 3]]
    assert [len(page['records']) for page in pages] == [10, 10, 3]
    ids = [row['id'] for page in pages for row in page['records']]
    assert len(set(ids)) == 23 and ids == sorted(ids)
    assert all(page['total'] == 23 for page in pages)
    assert 'EXCLUDED' not in str(pages) and 'user_id' not in str(pages)
    data = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h, params=PARAMS).json()
    assert data['total'] == 23


@pytest.mark.parametrize('change', [{'bucket_hours': 2}, {'bucket_hours': 6, 'started_at': '2026-11-01T01:00:00Z'},
    {'started_at': '2026-11-01T00:01:00Z'}, {'started_at': '2026-11-01T00:00:00'},
    {'ended_before': '2026-11-01T00:00:00Z'}, {'ended_before': '2026-12-03T00:00:00Z'},
    {'started_at': '1969-12-31T23:00:00Z'}, {'ended_before': '2101-01-01T00:00:00Z'}])
def test_invalid_or_unbounded_scope_refused(client, change):
    h = _register_and_login(client, 'time-invalid@example.com')
    identity = source_id(client, h)
    assert client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h,
                      params={**PARAMS, **change}).status_code == 422


@pytest.mark.parametrize('leaf', ['recorded-timeline', 'recorded-window-events'])
def test_foreign_admin_missing_inactive_and_anonymous_never_read(client, leaf):
    h = _register_and_login(client, 'time-auth-owner@example.com')
    identity = source_id(client, h)
    other = _register_and_login(client, 'time-auth-other@example.com')
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'time-auth-other@example.com').one().role = 'admin'
        db.commit()
    path = f'/api/v1/events/sources/{identity}/{leaf}'
    assert client.get(path, headers=other, params=PARAMS).status_code == 404
    assert client.get(f'/api/v1/events/sources/999999/{leaf}', headers=h, params=PARAMS).status_code == 404
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'time-auth-owner@example.com').one().is_active = False
        db.commit()
    assert client.get(path, headers=h, params=PARAMS).status_code == 403
    client.cookies.clear()
    assert client.get(path, params=PARAMS).status_code == 401


def test_window_page_constraints_and_maximum_distribution(client):
    h = _register_and_login(client, 'time-max@example.com')
    identity = source_id(client, h)
    path = f'/api/v1/events/sources/{identity}/recorded-window-events'
    for change in [{'page': 0}, {'page': 9999999999999999999999}, {'size': 101},
                   {'ended_before': '2026-11-02T00:00:00.000001Z'}]:
        assert client.get(path, headers=h, params={**PARAMS, **change}).status_code == 422
    data = client.get(f'/api/v1/events/sources/{identity}/recorded-timeline', headers=h,
        params={**PARAMS, 'ended_before': (START + timedelta(days=31)).isoformat()}).json()
    assert len(data['buckets']) == 744 and data['total'] == 0


@pytest.mark.parametrize('leaf', ['recorded-timeline', 'recorded-window-events'])
@pytest.mark.parametrize('identity', [0, -1, 9999999999999999999999999])
def test_invalid_source_ids_do_not_reach_database(client, leaf, identity):
    h = _register_and_login(client, 'time-source-invalid@example.com')
    assert client.get(f'/api/v1/events/sources/{identity}/{leaf}', headers=h, params=PARAMS).status_code == 422


def test_fractional_boundary_rows_and_pre_utc_overflow_are_safe(client):
    h = _register_and_login(client, 'time-fraction@example.com')
    identity = source_id(client, h)
    _make_event(client, h, source_id=identity, timestamp=START + timedelta(hours=1, microseconds=-1))
    _make_event(client, h, source_id=identity, timestamp=START + timedelta(hours=1))
    path = f'/api/v1/events/sources/{identity}'
    data = client.get(f'{path}/recorded-timeline', headers=h, params=PARAMS).json()
    assert [row['count'] for row in data['buckets']][:3] == [1, 1, 0]
    page = client.get(f'{path}/recorded-window-events', headers=h,
                     params={**PARAMS, 'ended_before': '2026-11-01T01:00:00Z'}).json()
    assert page['total'] == 1
    assert client.get(f'{path}/recorded-timeline', headers=h,
                     params={**PARAMS, 'started_at': '0001-01-01T00:00:00+14:00'}).status_code == 422
