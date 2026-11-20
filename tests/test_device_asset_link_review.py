"""Reviewed manual associations use current owned evidence and never create assets."""
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from test_ot_inventory_lifecycle import OWNER, SEEN, database

from backend.models.asset import Asset
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.ot import correlate_device_to_asset, review_device_correlation


async def seed(db):
    db.add_all([
        Asset(id=10, user_id=1, name='Existing gateway', asset_type='hardware', serial_number='A-100'),
        Asset(id=11, user_id=2, name='Foreign inventory', asset_type='hardware'),
        DiscoveredDevice(id=1, user_id=1, ip_address='192.0.2.10', hostname='Observed gateway',
                         discovery_method='sensor_report', serial_number='A-100',
                         first_seen=SEEN, last_seen=SEEN),
        DiscoveredDevice(id=2, user_id=2, ip_address='192.0.2.11', discovery_method='sensor_report'),
    ])
    await db.commit()


def test_review_and_link_preserve_evidence_and_existing_inventory(tmp_path):
    async def scenario():
        async with database(tmp_path / 'link.db') as db:
            await seed(db)
            review = await review_device_correlation(1, 10, current_user=OWNER, db=db)
            assert review['can_link'] and review['device']['asset_id'] is None
            assert review['asset']['name'] == 'Existing gateway'
            linked = await correlate_device_to_asset(1, 10, reviewed_fingerprint=review['reviewed_fingerprint'],
                                                     current_user=OWNER, db=db)
            assert linked.asset_id == 10 and linked.is_correlated and linked.correlation_score == 100
            assert linked.first_seen == SEEN and linked.last_seen == SEEN
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 2
            assert (await db.get(Asset, 10)).name == 'Existing gateway'
            with pytest.raises(HTTPException) as error:
                await correlate_device_to_asset(1, 10, reviewed_fingerprint=review['reviewed_fingerprint'],
                                                current_user=OWNER, db=db)
            assert error.value.status_code == 409
    asyncio.run(scenario())


@pytest.mark.parametrize('kind', ['device_serial', 'asset_serial', 'already_linked'])
def test_changed_record_or_link_rejects_prepared_association(tmp_path, kind):
    async def scenario():
        async with database(tmp_path / f'{kind}.db') as db:
            await seed(db)
            review = await review_device_correlation(1, 10, current_user=OWNER, db=db)
            device = await db.get(DiscoveredDevice, 1)
            if kind == 'device_serial':
                device.serial_number = 'Changed device'
            elif kind == 'asset_serial':
                (await db.get(Asset, 10)).serial_number = 'Changed inventory'
            else:
                device.asset_id, device.is_correlated = 10, True
            await db.commit()
            with pytest.raises(HTTPException) as error:
                await correlate_device_to_asset(1, 10, reviewed_fingerprint=review['reviewed_fingerprint'],
                                                current_user=OWNER, db=db)
            assert error.value.status_code == 409
            assert device.asset_id == (10 if kind == 'already_linked' else None)
    asyncio.run(scenario())


@pytest.mark.parametrize('device_id,asset_id', [(2, 10), (1, 11), (999, 10), (1, 999)])
def test_review_and_link_never_expose_foreign_or_missing_records(tmp_path, device_id, asset_id):
    async def scenario():
        async with database(tmp_path / f'{device_id}-{asset_id}.db') as db:
            await seed(db)
            for operation in [
                lambda: review_device_correlation(device_id, asset_id, current_user=OWNER, db=db),
                lambda: correlate_device_to_asset(device_id, asset_id, reviewed_fingerprint='a' * 64,
                                                  current_user=OWNER, db=db),
            ]:
                with pytest.raises(HTTPException) as error:
                    await operation()
                assert error.value.status_code == 404
    asyncio.run(scenario())


def test_inconsistent_link_cannot_be_overwritten_and_custom_score_not_accepted(tmp_path):
    async def scenario():
        async with database(tmp_path / 'inconsistent.db') as db:
            await seed(db)
            review = await review_device_correlation(1, 10, current_user=OWNER, db=db)
            with pytest.raises(HTTPException) as error:
                await correlate_device_to_asset(1, 10, correlation_score=0,
                    reviewed_fingerprint=review['reviewed_fingerprint'], current_user=OWNER, db=db)
            assert error.value.status_code == 422
            device = await db.get(DiscoveredDevice, 1)
            device.is_correlated = True
            await db.commit()
            review = await review_device_correlation(1, 10, current_user=OWNER, db=db)
            assert review['can_link'] is False
            with pytest.raises(HTTPException) as error:
                await correlate_device_to_asset(1, 10, reviewed_fingerprint=review['reviewed_fingerprint'],
                                                current_user=OWNER, db=db)
            assert error.value.status_code == 409 and device.asset_id is None
    asyncio.run(scenario())
