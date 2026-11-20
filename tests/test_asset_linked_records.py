"""Paged current evidence stays inside the exact owned asset and record owner."""
import pytest
from test_assets_risk import _register_and_login, _TestingSessionLocal
from test_assets_risk import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.discovered_device import DiscoveredDevice
from backend.models.sbom import SBOM
from backend.models.suppression_rule import AlertSuppressionRule


def seed(client):
    headers = _register_and_login(client, 'linked-records@example.com')
    other = _register_and_login(client, 'linked-other@example.com')
    asset = client.post('/api/v1/assets/', headers=headers,
                        json={'name': 'Gateway', 'asset_type': 'hardware'}).json()
    foreign = client.post('/api/v1/assets/', headers=other,
                          json={'name': 'Other inventory', 'asset_type': 'hardware'}).json()
    with _TestingSessionLocal() as db:
        owner = db.get(Asset, asset['id']).user_id
        foreign_owner = db.get(Asset, foreign['id']).user_id
        for index in range(1, 14):
            db.add(Alert(id=index, user_id=owner, asset_id=asset['id'], title=f'Finding {index}',
                         severity='high', status='resolved' if index == 13 else 'pending'))
            db.add(SBOM(id=index, user_id=owner, asset_id=asset['id'], format='SPDX',
                        source='upload', component_count=index, vulnerability_count=0))
            db.add(DiscoveredDevice(id=index, user_id=owner, asset_id=asset['id'],
                                    ip_address=f'192.0.2.{index}', hostname=f'Device {index}',
                                    discovery_method='sensor_report', is_correlated=True))
            db.add(AlertSuppressionRule(id=index, user_id=owner, asset_id=asset['id'],
                                        name=f'Rule {index}', enabled=index != 13, duration_hours=24))
        db.add(Alert(user_id=foreign_owner, asset_id=asset['id'], title='Unavailable private alert',
                     severity='low', status='pending'))
        db.add(Alert(user_id=owner, asset_id=foreign['id'], title='Different asset alert',
                     severity='low', status='pending'))
        db.add(Alert(user_id=owner, asset_id=asset['id'], title='Literal 100%_safe',
                     severity='low', status='pending'))
        db.commit()
    return headers, other, asset, foreign


@pytest.mark.parametrize('kind', ['alerts', 'sboms', 'discovered_devices', 'suppression_rules'])
def test_records_are_paged_and_owner_scoped_with_counts_before_search(client, kind):
    headers, _, asset, _ = seed(client)
    path = f"/api/v1/assets/{asset['id']}/linked-records"
    first = client.get(path, headers=headers, params={'kind': kind, 'size': 10}).json()
    second = client.get(path, headers=headers, params={'kind': kind, 'page': 2, 'size': 10}).json()
    assert first['asset_id'] == asset['id'] and first['kind'] == kind
    assert first['counts'] == {'alerts': 14, 'sboms': 13, 'discovered_devices': 13, 'suppression_rules': 13}
    assert first['unavailable_reference_count'] == 1
    assert len(first['records']) == 10 and len(second['records']) == (4 if kind == 'alerts' else 3)
    ids = [row['id'] for row in first['records'] + second['records']]
    assert len(ids) == len(set(ids)) and ids == sorted(ids, reverse=True)
    assert 'Unavailable private alert' not in str(first) + str(second)
    assert 'Different asset alert' not in str(first) + str(second)
    if kind == 'alerts':
        assert any(row['status'] == 'resolved' for row in first['records'])
    if kind == 'suppression_rules':
        assert first['records'][0]['enabled'] is False
    assert client.get(path, headers=headers, params={'kind': kind, 'page': 999}).json()['records'] == []


def test_search_is_literal_and_counts_remain_unfiltered(client):
    headers, _, asset, _ = seed(client)
    path = f"/api/v1/assets/{asset['id']}/linked-records"
    data = client.get(path, headers=headers, params={'kind': 'alerts', 'search': '100%_'}).json()
    assert data['total'] == 1 and data['records'][0]['title'] == 'Literal 100%_safe'
    assert data['counts']['alerts'] == 14
    data = client.get(path, headers=headers, params={'kind': 'suppression_rules', 'search': 'Rule 13'}).json()
    assert data['total'] == 1 and data['records'][0]['enabled'] is False
    assert client.get(path, headers=headers, params={'search': 'not recorded here'}).json()['total'] == 0


def test_foreign_and_missing_assets_remain_hidden_and_get_does_not_mutate(client):
    headers, other, asset, foreign = seed(client)
    path = f"/api/v1/assets/{asset['id']}/linked-records"
    assert client.get(path, headers=other).status_code == 404
    assert client.get(f"/api/v1/assets/{foreign['id']}/linked-records", headers=headers).status_code == 404
    assert client.get('/api/v1/assets/999999/linked-records', headers=headers).status_code == 404
    before = client.get(path, headers=headers).json()
    after = client.get(path, headers=headers).json()
    assert before['records'] == after['records'] and before['counts'] == after['counts']


@pytest.mark.parametrize('params', [{'kind': 'other'}, {'page': 0}, {'size': 101}, {'search': 'x' * 201}])
def test_invalid_scope_is_rejected(client, params):
    headers, _, asset, _ = seed(client)
    assert client.get(f"/api/v1/assets/{asset['id']}/linked-records", headers=headers,
                      params=params).status_code == 422
