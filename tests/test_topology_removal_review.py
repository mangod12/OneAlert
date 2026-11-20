"""Saved connection removal review guards every recorded field and owner boundary."""
from datetime import UTC, datetime

import pytest
from test_topology import TestingSessionLocal
from test_topology import auth_headers as auth_headers
from test_topology import client as client

from backend.models.network_connection import NetworkConnection


def create(client, headers):
    response = client.post('/api/v1/topology/connections', headers=headers,
                           json={'source_ip': '10.0.0.7', 'target_ip': '10.0.0.8', 'protocol': 'modbus',
                                 'port': 0, 'bytes_transferred': 9007199254740993})
    assert response.status_code == 201
    return response.json()['id']


def test_review_preserves_exact_values_and_guarded_remove_acknowledges_204(client, auth_headers):
    identity = create(client, auth_headers)
    path = f'/api/v1/topology/connections/{identity}'
    review = client.get(f'{path}/removal-review', headers=auth_headers).json()
    assert review['connection']['bytes_transferred'] == '9007199254740993'
    assert review['connection']['port'] == 0 and review['connection']['is_encrypted'] is False
    assert len(review['reviewed_fingerprint']) == 64 and 'user_id' not in review['connection']
    response = client.delete(path, headers=auth_headers,
                             params={'reviewed_fingerprint': review['reviewed_fingerprint']})
    assert response.status_code == 204
    assert client.get(f'{path}/removal-review', headers=auth_headers).status_code == 404


@pytest.mark.parametrize('field,value', [('source_ip', '10.0.0.9'), ('target_ip', '10.0.0.10'), ('protocol', 'https'),
                                       ('port', 443), ('direction', 'inbound'), ('is_encrypted', True),
                                       ('bytes_transferred', 55), ('source_device_id', 999), ('target_device_id', 998),
                                       ('first_seen', datetime(2026, 1, 1, tzinfo=UTC)),
                                       ('last_seen', datetime(2026, 1, 2, tzinfo=UTC))])
def test_changed_record_rejects_stale_review_and_keeps_current_evidence(client, auth_headers, field, value):
    identity = create(client, auth_headers)
    path = f'/api/v1/topology/connections/{identity}'
    review = client.get(f'{path}/removal-review', headers=auth_headers).json()
    with TestingSessionLocal() as db:
        setattr(db.get(NetworkConnection, identity), field, value)
        db.commit()
    assert client.delete(path, headers=auth_headers,
                         params={'reviewed_fingerprint': review['reviewed_fingerprint']}).status_code == 409
    fresh = client.get(f'{path}/removal-review', headers=auth_headers).json()
    assert fresh['reviewed_fingerprint'] != review['reviewed_fingerprint']
    assert client.delete(path, headers=auth_headers,
                         params={'reviewed_fingerprint': fresh['reviewed_fingerprint']}).status_code == 204


def test_legacy_timestamp_storage_and_unguarded_clients_remain_compatible(client, auth_headers):
    identity = create(client, auth_headers)
    path = f'/api/v1/topology/connections/{identity}'
    with TestingSessionLocal() as db:
        from sqlalchemy import text
        db.execute(text('UPDATE network_connections SET first_seen=CURRENT_TIMESTAMP,last_seen=CURRENT_TIMESTAMP'))
        db.commit()
    review = client.get(f'{path}/removal-review', headers=auth_headers).json()
    assert client.delete(path, headers=auth_headers,
                         params={'reviewed_fingerprint': review['reviewed_fingerprint']}).status_code == 204
    identity = create(client, auth_headers)
    assert client.delete(f'/api/v1/topology/connections/{identity}', headers=auth_headers).status_code == 204


def test_foreign_record_and_invalid_guard_cannot_remove_owned_evidence(client, auth_headers):
    identity = create(client, auth_headers)
    path = f'/api/v1/topology/connections/{identity}'
    assert client.delete(path, headers=auth_headers, params={'reviewed_fingerprint': 'bad'}).status_code == 422
    with TestingSessionLocal() as db:
        db.get(NetworkConnection, identity).user_id = 999
        db.commit()
    assert client.get(f'{path}/removal-review', headers=auth_headers).status_code == 404
    assert client.delete(path, headers=auth_headers).status_code == 404
