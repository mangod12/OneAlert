"""Stable, owner-scoped discovered-device pages, including tied risk and time."""
import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401 - register all related models
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.ot import list_discovered_devices


def test_device_pages_have_stable_tie_order_and_keep_owner_filters(tmp_path):
    async def check():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'devices.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            factory = async_sessionmaker(engine, expire_on_commit=False)
            async with factory() as db:
                seen = datetime(2026, 11, 20, 0, 0, tzinfo=UTC)
                for index in range(1, 26):
                    db.add(DiscoveredDevice(
                        id=index, user_id=1, ip_address=f"10.0.0.{index}",
                        discovery_method="sensor_report", risk_score=60,
                        is_ot_device=True, last_seen=seen,
                    ))
                for identity, owner, ip, is_ot in [
                    (26, 2, "10.0.0.26", True),
                    (27, 1, "10.0.0.27", False),
                    (28, 1, "192.168.0.1", True),
                ]:
                    db.add(DiscoveredDevice(
                        id=identity, user_id=owner, ip_address=ip,
                        discovery_method="sensor_report", risk_score=90, is_ot_device=is_ot,
                    ))
                await db.commit()
                options = dict(
                    size=20, ip_address="10.0.0.", ot_only=True,
                    risk_min=None, risk_max=None, correlated=None,
                    current_user=SimpleNamespace(id=1), db=db,
                )
                first = await list_discovered_devices(page=1, **options)
                second = await list_discovered_devices(page=2, **options)
                repeat = await list_discovered_devices(page=1, **options)
                assert first.total == second.total == 25
                assert [d.id for d in first.devices] == list(range(25, 5, -1))
                assert [d.id for d in second.devices] == [5, 4, 3, 2, 1]
                assert [d.id for d in repeat.devices] == [d.id for d in first.devices]
                assert not set(d.id for d in first.devices) & set(d.id for d in second.devices)
        finally:
            await engine.dispose()
    asyncio.run(check())
