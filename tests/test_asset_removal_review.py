"""Inventory removal preserves alert, SBOM, discovery and suppression references."""
import pytest
from test_assets_risk import _register_and_login, _TestingSessionLocal
from test_assets_risk import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.discovered_device import DiscoveredDevice
from backend.models.sbom import SBOM
from backend.models.suppression_rule import AlertSuppressionRule


def setup_asset(client):
    headers = _register_and_login(client, 'removal-review@example.com')
    response = client.post('/api/v1/assets/', headers=headers, json={'name': 'Gateway', 'asset_type': 'hardware'})
    assert response.status_code == 201
    return headers, response.json()


def test_empty_asset_review_and_delete(client):
    headers, asset = setup_asset(client)
    path = f"/api/v1/assets/{asset['id']}"
    review = client.get(path + '/removal-review', headers=headers).json()
    assert review['can_delete'] is True
    assert review['dependencies'] == {'alerts': 0, 'sboms': 0, 'discovered_devices': 0, 'suppression_rules': 0}
    assert client.get(path, headers=headers).status_code == 200
    assert client.delete(path, headers=headers, params={
        'reviewed_fingerprint': review['reviewed_fingerprint'],
    }).status_code == 204
    assert client.get(path, headers=headers).status_code == 404


@pytest.mark.parametrize('kind', ['alerts', 'sboms', 'discovered_devices', 'suppression_rules'])
def test_linked_records_block_guarded_and_legacy_removal(client, kind):
    headers, asset = setup_asset(client)
    path = f"/api/v1/assets/{asset['id']}"
    with _TestingSessionLocal() as db:
        owner = db.get(Asset, asset['id']).user_id
        rows = {
            'alerts': lambda: Alert(asset_id=asset['id'], user_id=owner, title='Closed alert',
                                    severity='low', status='resolved'),
            'sboms': lambda: SBOM(asset_id=asset['id'], user_id=owner, format='CycloneDX'),
            'discovered_devices': lambda: DiscoveredDevice(asset_id=asset['id'], user_id=owner,
                ip_address='192.0.2.9', discovery_method='manual'),
            'suppression_rules': lambda: AlertSuppressionRule(asset_id=asset['id'], user_id=owner,
                name='Gateway noise', duration_hours=24, enabled=False),
        }
        row = rows[kind]()
        db.add(row)
        db.commit()
        row_id, model = row.id, type(row)
    review = client.get(path + '/removal-review', headers=headers).json()
    assert review['can_delete'] is False and review['dependencies'][kind] == 1
    assert client.delete(path, headers=headers).status_code == 409
    assert client.delete(path, headers=headers, params={
        'reviewed_fingerprint': review['reviewed_fingerprint'],
    }).status_code == 409
    assert client.get(path, headers=headers).status_code == 200
    with _TestingSessionLocal() as db:
        assert db.get(model, row_id).asset_id == asset['id']


def test_changed_asset_metadata_invalidates_removal_review(client):
    headers, asset = setup_asset(client)
    path = f"/api/v1/assets/{asset['id']}"
    review = client.get(path + '/removal-review', headers=headers).json()
    assert client.put(path, headers=headers, json={'criticality': 'critical'}).status_code == 200
    assert client.delete(path, headers=headers, params={
        'reviewed_fingerprint': review['reviewed_fingerprint'],
    }).status_code == 409
    assert client.get(path, headers=headers).json()['criticality'] == 'critical'


def test_missing_foreign_and_invalid_review_do_not_delete(client):
    headers, asset = setup_asset(client)
    path = f"/api/v1/assets/{asset['id']}"
    other = _register_and_login(client, 'removal-other@example.com')
    assert client.get(path + '/removal-review', headers=other).status_code == 404
    assert client.delete(path, headers=other).status_code == 404
    assert client.get('/api/v1/assets/999999/removal-review', headers=headers).status_code == 404
    assert client.delete(path, headers=headers, params={'reviewed_fingerprint': 'bad'}).status_code == 422
    assert client.delete(path, headers=headers, params={'reviewed_fingerprint': 'a' * 64}).status_code == 409
    assert client.get(path, headers=headers).status_code == 200


def test_new_reference_after_review_prevents_removal(client):
    headers, asset = setup_asset(client)
    path = f"/api/v1/assets/{asset['id']}"
    review = client.get(path + '/removal-review', headers=headers).json()
    with _TestingSessionLocal() as db:
        owner = db.get(Asset, asset['id']).user_id
        db.add(SBOM(asset_id=asset['id'], user_id=owner, format='SPDX'))
        db.commit()
    assert client.delete(path, headers=headers, params={
        'reviewed_fingerprint': review['reviewed_fingerprint'],
    }).status_code == 409
    assert client.get(path, headers=headers).status_code == 200


def test_unreferenced_legacy_delete_remains_supported(client):
    headers, asset = setup_asset(client)
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=headers).status_code == 204
