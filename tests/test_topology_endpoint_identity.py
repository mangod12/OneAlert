"""Topology must not choose a device identity from ambiguous IP matches."""
import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.discovered_device import DiscoveredDevice
from backend.models.network_connection import NetworkConnection
from backend.services.topology_service import build_topology_graph


def test_duplicate_ip_keeps_every_owned_record_without_arbitrary_label_or_risk(tmp_path):
    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'identity.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add_all([
                    DiscoveredDevice(id=7, user_id=1, ip_address='192.0.2.1', hostname='west-controller',
                                     risk_score=0, discovery_method='sensor_report'),
                    DiscoveredDevice(id=3, user_id=1, ip_address='192.0.2.1', hostname='east-controller',
                                     risk_score=84, discovery_method='sensor_report'),
                    DiscoveredDevice(id=9, user_id=2, ip_address='192.0.2.1', hostname='private-other-owner',
                                     risk_score=99, discovery_method='sensor_report'),
                    DiscoveredDevice(id=11, user_id=1, ip_address='192.0.2.2', hostname='gateway',
                                     risk_score=0, discovery_method='sensor_report'),
                    NetworkConnection(user_id=1, source_ip='192.0.2.1', target_ip='192.0.2.3', protocol='tcp'),
                ])
                await db.commit()
                graph = await build_topology_graph(1, db)
                nodes = {item['id']: item for item in graph['nodes']}
                ambiguous = nodes['192.0.2.1']
                assert ambiguous['label'] == '192.0.2.1' and ambiguous['type'] == 'ambiguous'
                assert ambiguous['device_id'] is None and ambiguous['risk_score'] is None
                assert ambiguous['identity_status'] == 'multiple_records'
                assert [item['id'] for item in ambiguous['device_records']] == [3, 7]
                assert [item['risk_score'] for item in ambiguous['device_records']] == [84, 0]
                assert 'private-other-owner' not in str(graph)
                assert nodes['192.0.2.2']['label'] == 'gateway'
                assert nodes['192.0.2.2']['risk_score'] == 0
                assert nodes['192.0.2.2']['identity_status'] == 'single_record'
                assert nodes['192.0.2.3']['device_records'] == []
                assert nodes['192.0.2.3']['identity_status'] == 'unmatched'
                assert nodes['192.0.2.3']['risk_score'] is None
        finally:
            await engine.dispose()
    asyncio.run(scenario())
