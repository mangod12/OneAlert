"""Discovery evidence survives source retirement and safe inventory linking."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.asset import Asset
from backend.models.discovered_device import (
    DiscoveredDevice,
    DiscoveredDeviceCreate,
    DiscoveredDeviceUpdate,
    NetworkSensor,
)
from backend.routers.ot import (
    correlate_device_to_asset,
    create_discovered_device,
    delete_network_sensor,
    promote_device_to_asset,
    update_discovered_device,
)

OWNER = SimpleNamespace(id=1)
SEEN = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC).replace(tzinfo=None)  # SQLite stores naive UTC


@asynccontextmanager
async def database(path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            yield db
    finally:
        await engine.dispose()


def test_sensor_retirement_unlinks_and_retains_all_historical_device_evidence(tmp_path):
    async def scenario():
        async with database(tmp_path / "retirement.db") as db:
            db.add(NetworkSensor(id=10, user_id=1, name="Old source", sensor_type="passive"))
            for identity, owner in [(1, 1), (2, 1), (3, 2)]:
                # Include a legacy foreign-owner source association. Retiring its
                # source must not cascade-delete that other owner's evidence.
                db.add(
                    DiscoveredDevice(
                        id=identity,
                        user_id=owner,
                        sensor_id=10,
                        ip_address=f"192.0.2.{identity}",
                        discovery_method="sensor_report",
                        last_seen=SEEN,
                        first_seen=SEEN,
                        protocols=["modbus"],
                        notes="Keep evidence",
                    )
                )
            await db.commit()
            db.expire_all()
            await delete_network_sensor(10, current_user=OWNER, db=db)
            db.expire_all()
            rows = (await db.execute(select(DiscoveredDevice).order_by(DiscoveredDevice.id))).scalars().all()
            assert len(rows) == 3
            assert all(row.sensor_id is None and row.notes == "Keep evidence" for row in rows)
            assert all(row.last_seen == SEEN and row.first_seen == SEEN and row.protocols == ["modbus"] for row in rows)
            assert (await db.execute(select(func.count(NetworkSensor.id)))).scalar_one() == 0

    asyncio.run(scenario())


def test_source_association_requires_owned_sensor_and_rejects_missing_without_writes(tmp_path):
    async def scenario():
        async with database(tmp_path / "source.db") as db:
            db.add_all(
                [
                    NetworkSensor(id=10, user_id=1, name="Owned", sensor_type="passive"),
                    NetworkSensor(id=11, user_id=2, name="Other", sensor_type="passive"),
                ]
            )
            await db.commit()
            for sensor in [11, 999]:
                with pytest.raises(HTTPException) as error:
                    await create_discovered_device(
                        DiscoveredDeviceCreate(
                            sensor_id=sensor, ip_address="192.0.2.1", discovery_method="manual_import"
                        ),
                        current_user=OWNER,
                        db=db,
                    )
                assert error.value.status_code == 404
                assert error.value.detail == "Sensor not found"
            assert (await db.execute(select(func.count(DiscoveredDevice.id)))).scalar_one() == 0
            for sensor in [10, None]:
                created = await create_discovered_device(
                    DiscoveredDeviceCreate(sensor_id=sensor, ip_address="192.0.2.1", discovery_method="manual_import"),
                    current_user=OWNER,
                    db=db,
                )
                assert created.sensor_id == sensor
                assert created.user_id == 1

    asyncio.run(scenario())


def test_promote_is_repeatable_without_duplicate_assets_or_fake_last_seen(tmp_path):
    async def scenario():
        async with database(tmp_path / "promotion.db") as db:
            db.add(
                DiscoveredDevice(
                    id=1,
                    user_id=1,
                    ip_address="192.0.2.1",
                    hostname="PLC-1",
                    discovery_method="sensor_report",
                    is_ot_device=True,
                    risk_score=80,
                    last_seen=SEEN,
                    first_seen=SEEN,
                    protocols=["modbus", "tcp"],
                )
            )
            await db.commit()
            first = await promote_device_to_asset(1, current_user=OWNER, db=db)
            db.expire_all()
            second = await promote_device_to_asset(1, current_user=OWNER, db=db)
            assert first["asset_id"] == second["asset_id"]
            assert second["asset_name"] == "PLC-1"
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 1
            device = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == 1))).scalar_one()
            assert device.last_seen == SEEN and device.first_seen == SEEN
            asset = (await db.execute(select(Asset))).scalar_one()
            assert asset.user_id == 1 and asset.primary_protocol == "modbus"
            assert asset.secondary_protocols == '["tcp"]'
            await update_discovered_device(
                1, DiscoveredDeviceUpdate(notes="Analyst review", hostname="PLC renamed"), current_user=OWNER, db=db
            )
            db.expire_all()
            device = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == 1))).scalar_one()
            assert device.last_seen == SEEN

    asyncio.run(scenario())


@pytest.mark.parametrize("asset_id,correlated", [(10, True), (None, True), (10, False), (999, True)])
def test_inconsistent_or_foreign_links_never_create_or_expose_asset(tmp_path, asset_id, correlated):
    async def scenario():
        async with database(tmp_path / "inconsistent.db") as db:
            db.add(Asset(id=10, user_id=2, name="Private asset", asset_type="hardware"))
            db.add(
                DiscoveredDevice(
                    id=1,
                    user_id=1,
                    ip_address="192.0.2.1",
                    discovery_method="sensor_report",
                    asset_id=asset_id,
                    is_correlated=correlated,
                )
            )
            await db.commit()
            with pytest.raises(HTTPException) as error:
                await promote_device_to_asset(1, current_user=OWNER, db=db)
            assert error.value.status_code == 409
            assert "Private asset" not in error.value.detail
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 1

    asyncio.run(scenario())


def test_explicit_correlation_score_zero_survives_and_does_not_claim_new_observation(tmp_path):
    async def scenario():
        async with database(tmp_path / "correlation.db") as db:
            db.add(Asset(id=10, user_id=1, name="Managed PLC", asset_type="hardware"))
            db.add(
                DiscoveredDevice(
                    id=1, user_id=1, ip_address="192.0.2.1", discovery_method="sensor_report", last_seen=SEEN
                )
            )
            await db.commit()
            linked = await correlate_device_to_asset(1, 10, correlation_score=0, current_user=OWNER, db=db)
            assert linked.correlation_score == 0
            assert linked.last_seen == SEEN
            again = await promote_device_to_asset(1, current_user=OWNER, db=db)
            assert again["asset_id"] == 10
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 1

    asyncio.run(scenario())


def test_lifecycle_mutations_keep_device_and_sensor_owner_checks(tmp_path):
    async def scenario():
        async with database(tmp_path / "owners.db") as db:
            db.add(NetworkSensor(id=10, user_id=2, name="Private source", sensor_type="passive"))
            db.add(DiscoveredDevice(id=1, user_id=2, ip_address="192.0.2.1", discovery_method="sensor_report"))
            await db.commit()
            for operation in [
                lambda: delete_network_sensor(10, current_user=OWNER, db=db),
                lambda: promote_device_to_asset(1, current_user=OWNER, db=db),
            ]:
                with pytest.raises(HTTPException) as error:
                    await operation()
                assert error.value.status_code == 404
            assert (await db.execute(select(func.count(NetworkSensor.id)))).scalar_one() == 1
            assert (await db.execute(select(func.count(DiscoveredDevice.id)))).scalar_one() == 1
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 0

    asyncio.run(scenario())


def test_actual_sensor_report_still_advances_observed_last_seen(tmp_path):
    from backend.routers.sensor_ingest import _process_ingested_device

    async def scenario():
        async with database(tmp_path / "observed.db") as db:
            db.add(NetworkSensor(id=10, user_id=1, name="Source", sensor_type="passive"))
            db.add(
                DiscoveredDevice(
                    id=1,
                    user_id=1,
                    sensor_id=10,
                    ip_address="192.0.2.1",
                    discovery_method="sensor_report",
                    last_seen=SEEN,
                    first_seen=SEEN,
                )
            )
            await db.commit()
            result = await _process_ingested_device(
                db, 1, 10, {"ip_address": "192.0.2.1", "hostname": "Observed PLC"}, "sensor_report"
            )
            assert result["status"] == "updated"
            db.expire_all()
            device = (await db.execute(select(DiscoveredDevice))).scalar_one()
            assert device.last_seen > SEEN
            assert device.first_seen == SEEN

    asyncio.run(scenario())
