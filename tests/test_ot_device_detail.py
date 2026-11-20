"""Recorded discovery detail is readable only by its owner."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401 - register related models
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.ot import get_discovered_device


def test_recorded_device_detail_checks_owner_and_preserves_evidence(tmp_path):
    async def check():
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'detail.db'}")
        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add(DiscoveredDevice(
                    id=21, user_id=1, ip_address="192.0.2.21", discovery_method="sensor_report",
                    ports_open=[502], protocols=["modbus"], firmware_version="4.2",
                    notes="Review before promotion", confidence="medium", risk_score=62,
                ))
                await db.commit()
                result = await get_discovered_device(21, current_user=SimpleNamespace(id=1), db=db)
                assert result.ports_open == [502]
                assert result.protocols == ["modbus"]
                assert result.firmware_version == "4.2"
                assert result.notes == "Review before promotion"
                for device_id, owner in [(21, 2), (999, 1)]:
                    with pytest.raises(HTTPException) as error:
                        await get_discovered_device(device_id, current_user=SimpleNamespace(id=owner), db=db)
                    assert error.value.status_code == 404
        finally:
            await engine.dispose()
    asyncio.run(check())
