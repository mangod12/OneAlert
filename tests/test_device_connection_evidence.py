"""Connection review is owner-scoped, bounded and explicit about match evidence."""
import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.discovered_device import DiscoveredDevice
from backend.models.network_connection import NetworkConnection
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'device-connections.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([DiscoveredDevice(id=i, user_id=2 if i == 2 else 1,
                                        ip_address='192.0.2.1' if i in (1, 3) else '192.0.2.2',
                                        discovery_method='manual_import') for i in (1, 2, 3)])
            timestamp = datetime(2026, 11, 20, 1, tzinfo=UTC)
            for i, owner, source, target, source_id, target_id in [
                (1, 1, '192.0.2.1', '192.0.2.10', None, None),
                (2, 1, '192.0.2.99', '192.0.2.10', 1, None),
                (3, 1, '192.0.2.1', '192.0.2.10', 1, None),
                (4, 2, '192.0.2.1', '192.0.2.10', None, None),
                (5, 1, '192.0.2.99', '192.0.2.10', None, None),
                (6, 1, '192.0.2.10', '192.0.2.1', None, None),
                (7, 1, '192.0.2.10', '192.0.2.99', None, 1),
            ]:
                db.add(NetworkConnection(id=i, user_id=owner, source_ip=source, target_ip=target,
                                         source_device_id=source_id, target_device_id=target_id,
                                         protocol='modbus', port=0, is_encrypted=i % 2 == 0,
                                         bytes_transferred=9223372036854775807,
                                         first_seen=timestamp, last_seen=timestamp))
            await db.commit()
            await db.execute(update(NetworkConnection).where(NetworkConnection.id == 7)
                             .values(is_encrypted=None, bytes_transferred=None))
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


def read(client, device=1, **params):
    response = client.get(f'/api/v1/ot/discovered-devices/{device}/connections', params=params)
    assert response.status_code == 200
    return response.json()


def test_owner_scope_both_endpoint_sides_and_exact_missing_fields(client):
    result = read(client)
    assert [row['id'] for row in result['connections']] == [7, 6, 3, 2, 1]
    assert result['total'] == 5 and result['device_id'] == 1 and result['retrieved_at']
    by_id = {row['id']: row for row in result['connections']}
    assert by_id[1]['ip_address_match'] and not by_id[1]['record_reference_match']
    assert not by_id[2]['ip_address_match'] and by_id[2]['record_reference_match']
    assert by_id[3]['ip_address_match'] and by_id[3]['record_reference_match']
    assert by_id[1]['bytes_transferred_exact'] == '9223372036854775807' and by_id[1]['port'] == 0
    assert by_id[7]['bytes_transferred_exact'] is None and by_id[7]['is_encrypted'] is None
    assert all('user_id' not in row for row in result['connections'])


def test_filters_preserve_shared_ip_ambiguity_and_distinguish_explicit_references(client):
    assert [r['id'] for r in read(client, match='record')['connections']] == [7, 3, 2]
    assert [r['id'] for r in read(client, match='ip')['connections']] == [6, 3, 1]
    assert [r['id'] for r in read(client, encryption='encrypted')['connections']] == [6, 2]
    assert [r['id'] for r in read(client, encryption='cleartext')['connections']] == [3, 1]
    # Another owned inventory record has the same IP, but no explicit references.
    assert read(client, device=3, match='record')['total'] == 0
    assert read(client, device=3, match='ip')['total'] == 3


def test_pagination_is_bounded_stable_and_does_not_duplicate_or_write(client):
    first = read(client, size=2)
    second = read(client, size=2, page=2)
    assert [r['id'] for r in first['connections']] == [7, 6]
    assert [r['id'] for r in second['connections']] == [3, 2]
    assert second['total'] == 5 and read(client, size=2, page=4)['connections'] == []
    assert read(client)['total'] == 5


@pytest.mark.parametrize('device', [2, 999])
def test_missing_and_foreign_device_are_indistinguishable(client, device):
    response = client.get(f'/api/v1/ot/discovered-devices/{device}/connections')
    assert response.status_code == 404 and response.json()['error']['message'] == 'Device not found'


@pytest.mark.parametrize('params', [
    {'size': 0}, {'size': 101}, {'page': 0}, {'page': 1000001},
    {'match': 'guessed'}, {'encryption': 'unknown'},
])
def test_invalid_filters_are_rejected(client, params):
    assert client.get('/api/v1/ot/discovered-devices/1/connections', params=params).status_code == 422


def test_topology_rollups_do_not_count_missing_encryption_as_cleartext(client):
    stats = client.get('/api/v1/topology/stats').json()
    assert stats['total_connections'] == 6
    assert stats['encrypted'] == 2 and stats['unencrypted'] == 3 and stats['encryption_unknown'] == 1
    assert stats['encrypted'] + stats['unencrypted'] + stats['encryption_unknown'] == stats['total_connections']
    graph = client.get('/api/v1/topology/graph').json()
    assert next(row for row in graph['edges'] if row['id'] == 7)['is_encrypted'] is None
