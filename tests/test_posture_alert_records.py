"""Current posture source records stay scoped and explain timing exclusions."""
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from test_reports import TestingSessionLocal
from test_reports import auth_headers as auth_headers
from test_reports import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.user import User

PATH = '/api/v1/reports/posture/alert-records'


@pytest.mark.parametrize('metric,key,time_key', [
    ('opened', 'opened', None), ('acknowledged', 'acknowledged', 'mtta_seconds'),
    ('resolved', 'resolved', 'mttr_seconds'),
])
def test_source_matches_existing_posture_metrics(client, auth_headers, metric, key, time_key):
    summary = client.get('/api/v1/reports/posture', headers=auth_headers).json()['alerts']
    response = client.get(PATH, params={'metric': metric}, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data['source_count'] == data['total'] == len(data['records']) == summary[key]
    assert data['mean_seconds'] == pytest.approx(summary[time_key]) if time_key else data['mean_seconds'] is None
    assert all(row['duration_seconds'] is None for row in data['records']) if not time_key else True
    assert data['metric'] == metric and data['days'] == 30
    client.cookies.clear()
    assert client.get(PATH).status_code in (401, 403)


def seed_more():
    now = datetime.now(UTC).replace(tzinfo=None)
    with TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == 'reports_test@example.com')).scalar_one()
        asset = db.execute(select(Asset).where(Asset.user_id == user.id)).scalars().first()
        for i in range(25):
            db.add(Alert(user_id=user.id, asset_id=asset.id, title=f'Tie 100%_safe {i}',
                         severity='high', status='resolved', created_at=now - timedelta(days=60),
                         acknowledged_at=now - timedelta(days=1), resolved_at=now - timedelta(days=1)))
        db.add(Alert(user_id=user.id, asset_id=asset.id, title='Negative timing', severity='low',
                     status='pending', created_at=now, acknowledged_at=now - timedelta(hours=1)))
        foreign = User(email='private-posture@example.test', hashed_password='unused', is_active=True)
        db.add(foreign)
        db.flush()
        db.add(Alert(user_id=foreign.id, asset_id=asset.id, title='Tie 100%_safe private', severity='high',
                     status='resolved', created_at=now, acknowledged_at=now, resolved_at=now))
        db.commit()


def test_old_creation_recent_response_negative_duration_and_foreign_records(client, auth_headers):
    seed_more()
    data = client.get(PATH, headers=auth_headers, params={'metric': 'acknowledged', 'limit': 100}).json()
    assert data['source_count'] == 27 and data['timing_count'] == 26 and data['excluded_timing_count'] == 1
    negative = next(row for row in data['records'] if row['title'] == 'Negative timing')
    assert negative['duration_seconds'] is None and 'Excluded' in negative['timing_reason']
    assert all('private' not in row['title'] for row in data['records'])
    assert data['mean_seconds'] > 0
    summary = client.get('/api/v1/reports/posture', headers=auth_headers).json()['alerts']
    assert summary['acknowledged'] == data['source_count']
    assert summary['mtta_seconds'] == pytest.approx(data['mean_seconds'])
    opened = client.get(PATH, headers=auth_headers).json()
    assert opened['source_count'] == 4  # 25 old-created alerts only belong to response metrics


def test_literal_full_scope_search_stable_pages_and_unfiltered_mean(client, auth_headers):
    seed_more()
    params = {'metric': 'resolved', 'query': ' 100%_SAFE ', 'limit': 10}
    pages = [client.get(PATH, headers=auth_headers, params={**params, 'offset': offset}).json()
             for offset in (0, 10, 20)]
    assert [len(page['records']) for page in pages] == [10, 10, 5]
    ids = [row['id'] for page in pages for row in page['records']]
    assert ids == sorted(ids, reverse=True) and len(set(ids)) == 25
    full = client.get(PATH, headers=auth_headers, params={'metric': 'resolved'}).json()
    assert all(page['total'] == 25 and page['source_count'] == 26 and page['mean_seconds'] == full['mean_seconds']
               for page in pages)
    for query in ('100xxsafe', 'no such title', '%private%'):
        response = client.get(PATH, headers=auth_headers, params={'metric': 'resolved', 'query': query})
        assert response.json()['total'] == 0
    for query in (str(ids[0]), 'high', 'resolved'):
        assert client.get(PATH, headers=auth_headers, params={'metric': 'resolved', 'query': query}).json()['total'] > 0
    assert client.get(PATH, headers=auth_headers, params={**params, 'offset': 1000}).json()['records'] == []


@pytest.mark.parametrize('params', [
    {'metric': 'all'}, {'days': 0}, {'days': 91}, {'offset': -1}, {'limit': 101}, {'query': 'x' * 201},
])
def test_reject_bad_scope(client, auth_headers, params):
    assert client.get(PATH, headers=auth_headers, params=params).status_code == 422


def test_no_timing_is_unknown_but_zero_duration_is_real(client, auth_headers):
    from sqlalchemy import update

    with TestingSessionLocal() as db:
        db.execute(update(Alert).values(acknowledged_at=None))
        db.commit()
    empty = client.get(PATH, headers=auth_headers, params={'metric': 'acknowledged'}).json()
    assert empty['source_count'] == empty['timing_count'] == empty['excluded_timing_count'] == 0
    assert empty['mean_seconds'] is None and empty['records'] == []
    with TestingSessionLocal() as db:
        row = db.execute(select(Alert)).scalars().first()
        now = datetime.now(UTC).replace(tzinfo=None)
        row.created_at = now
        row.acknowledged_at = now
        db.commit()
    zero = client.get(PATH, headers=auth_headers, params={'metric': 'acknowledged'}).json()
    assert zero['mean_seconds'] == zero['records'][0]['duration_seconds'] == 0
    assert zero['timing_count'] == 1
    with TestingSessionLocal() as db:
        db.execute(update(Alert).where(Alert.acknowledged_at.isnot(None)).values(created_at=None))
        db.commit()
    unknown = client.get(PATH, headers=auth_headers, params={'metric': 'acknowledged'}).json()
    assert unknown['source_count'] == unknown['excluded_timing_count'] == 1 and unknown['timing_count'] == 0
    assert unknown['mean_seconds'] is None and unknown['records'][0]['duration_seconds'] is None
