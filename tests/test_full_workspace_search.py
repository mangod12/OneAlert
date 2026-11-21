"""All owned search groups remain complete beyond palette previews."""
from datetime import UTC, datetime

import pytest
from test_search import TestingSessionLocal
from test_search import auth_headers as auth_headers
from test_search import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.security_event import SecurityEvent
from backend.models.user import User

PATH = '/api/v1/search/records'


def seed():
    with TestingSessionLocal() as db:
        owner = db.query(User).filter_by(email='search_test@example.com').one().id
        now = datetime(2026, 11, 1, tzinfo=UTC)
        for index in range(23):
            asset = Asset(user_id=owner, name=f'Search 100%_safe {index:02}', asset_type='hardware')
            db.add(asset)
            db.flush()
            for severity in ('low', 'critical'):
                db.add(Alert(user_id=owner, asset_id=asset.id, title=f'Search 100%_safe {index}',
                             severity=severity, status='pending', created_at=now))
            db.add(Case(user_id=owner, title=f'Search 100%_safe {index}', severity='high',
                        status='open', created_at=now))
            db.add(SecurityEvent(user_id=owner, signature=f'Search 100%_safe {index}',
                                 event_type='alert', severity='high', timestamp=now,
                                 raw_data={'secret': 'raw-only-text'}))
        foreign = Asset(user_id=999, name='Search 100%_safe private', asset_type='hardware')
        db.add(foreign)
        db.flush()
        db.add_all([
            Alert(user_id=999, asset_id=foreign.id, title='Search 100%_safe private', severity='critical'),
            Alert(user_id=owner, asset_id=foreign.id, title='foreign asset alert', severity='high', status='pending'),
            Alert(user_id=owner, asset_id=foreign.id, title='foreign asset alert 2', severity='high', status='pending'),
            Case(user_id=999, title='Search 100%_safe private', severity='high', status='open'),
            SecurityEvent(user_id=999, signature='Search 100%_safe private', event_type='alert', timestamp=now),
        ])
        db.commit()


@pytest.mark.parametrize('kind,expected', [('alerts', 46), ('cases', 23), ('assets', 23),
                                          ('events', 23), ('incidents', 23)])
def test_full_counts_stable_pages_and_preview_alignment(client, auth_headers, kind, expected):
    seed()
    params = {'q': ' 100%_SAFE ', 'kind': kind, 'size': 10}
    pages = [client.get(PATH, headers=auth_headers, params={**params, 'page': page}).json()
             for page in range(1, (expected + 9) // 10 + 1)]
    records = [row for page in pages for row in page['records']]
    key = 'asset_id' if kind == 'incidents' else 'id'
    ids = [row[key] for row in records]
    assert len(ids) == len(set(ids)) == expected
    assert all(page['total'] == expected and page['totals'][kind] == expected for page in pages)
    assert all(page['query'] == '100%_SAFE' and page['kind'] == kind for page in pages)
    assert all(len(page['records']) <= 10 for page in pages)
    assert 'private' not in str(records) and 'raw_data' not in str(records)
    if kind in ('alerts', 'cases', 'events'):
        assert ids == sorted(ids, reverse=True)
    else:
        assert ids == sorted(ids)
    if kind == 'incidents':
        assert all(row['max_severity'] == 'critical' and row['alert_count'] == 2 for row in records)
    preview = client.get('/api/v1/search/', headers=auth_headers, params={'q': params['q']}).json()['data']
    assert preview['preview_limit'] == 5 and preview['totals'][kind] == expected
    assert preview[kind] == records[:5]
    assert client.get(PATH, headers=auth_headers, params={**params, 'page': 999}).json()['records'] == []


def test_literal_unsearched_payload_auth_and_invalid_scope(client, auth_headers):
    seed()
    for query in ('100xxsafe', 'raw-only-text', 'private', chr(92) * 2):
        value = client.get(PATH, headers=auth_headers, params={'q': query}).json()
        assert value['records'] == [] and all(count == 0 for count in value['totals'].values())
    for params in ({'q': '  '}, {'q': ' x '}, {'q': 'x' * 201}, {'q': 'safe', 'kind': 'unknown'},
                   {'q': 'safe', 'page': 0}, {'q': 'safe', 'size': 101}):
        assert client.get(PATH, headers=auth_headers, params=params).status_code == 422
    client.cookies.clear()
    assert client.get(PATH, params={'q': 'safe'}).status_code == 401
