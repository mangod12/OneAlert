"""Connection evidence has bounded values and owner-safe device references."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.auth import get_active_user

BASE = {'source_ip': '192.0.2.1', 'target_ip': '192.0.2.2', 'protocol': 'modbus'}


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'topology-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([DiscoveredDevice(id=1, user_id=1, ip_address='192.0.2.1', discovery_method='manual_import'),
                        DiscoveredDevice(id=2, user_id=2, ip_address='192.0.2.2', discovery_method='manual_import')])
            await db.commit()
    asyncio.run(prepare())

    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        asyncio.run(engine.dispose())


@pytest.mark.parametrize('field,value', [
    ('source_ip', 'not-ip'), ('target_ip', ''), ('protocol', ' '),
    ('port', -1), ('port', 65536), ('port', True), ('port', 1.5), ('port', '502'),
    ('bytes_transferred', -1), ('bytes_transferred', 9223372036854775808),
    ('bytes_transferred', True), ('bytes_transferred', 1.5),
    ('direction', 'imagined'), ('is_encrypted', 'false'), ('source_device_id', 0),
])
def test_invalid_observation_does_not_create_a_connection(client, field, value):
    assert client.post('/api/v1/topology/connections', json={**BASE, field: value}).status_code == 422
    assert client.get('/api/v1/topology/connections').json() == []


@pytest.mark.parametrize('field', ['source_device_id', 'target_device_id'])
@pytest.mark.parametrize('identity', [2, 999])
def test_single_and_batch_cannot_link_another_users_or_missing_device(client, field, identity):
    invalid = {**BASE, field: identity}
    assert client.post('/api/v1/topology/connections', json=invalid).status_code == 404
    assert client.post('/api/v1/topology/connections/batch', json=[BASE, invalid]).status_code == 404
    assert client.get('/api/v1/topology/connections').json() == []


def test_recorded_graph_evidence_preserves_exact_bytes_zero_port_and_owned_device(client):
    response = client.post('/api/v1/topology/connections', json={
        **BASE, 'source_device_id': 1, 'port': 0, 'direction': 'outbound',
        'bytes_transferred': 9223372036854775807, 'is_encrypted': False,
    })
    assert response.status_code == 201
    edge = client.get('/api/v1/topology/graph').json()['edges'][0]
    assert edge['id'] == response.json()['id'] and edge['source_device_id'] == 1
    assert edge['bytes_transferred_exact'] == '9223372036854775807'
    assert edge['bytes_transferred'] == 9223372036854775807
    assert edge['port'] == 0 and edge['direction'] == 'outbound' and edge['is_encrypted'] is False
    assert edge['first_seen'] and edge['last_seen']


def test_batch_limits_and_ipv6_canonicalization(client):
    assert client.post('/api/v1/topology/connections/batch', json=[]).status_code == 422
    assert client.post('/api/v1/topology/connections/batch', json=[BASE] * 1001).status_code == 422
    response = client.post('/api/v1/topology/connections', json={
        **BASE, 'source_ip': ' 2001:0db8::1 ', 'protocol': ' tcp ',
    })
    assert response.status_code == 201
    assert response.json()['source_ip'] == '2001:db8::1' and response.json()['protocol'] == 'tcp'
