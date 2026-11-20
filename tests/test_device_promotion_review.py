"""Promotion reviews bind copied fields and possible duplicate inventory to one device."""
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from test_ot_inventory_lifecycle import OWNER, SEEN, database

from backend.models.asset import Asset
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.ot import promote_device_to_asset, review_device_promotion


async def seed(db):
    db.add(DiscoveredDevice(id=1, user_id=1, ip_address='192.0.2.10', hostname='Observed PLC',
                           manufacturer='Example', model='M-10', firmware_version='4.2', serial_number='S-10',
                           is_ot_device=True, ot_device_type='plc', risk_score=80,
                           discovery_method='sensor_report', protocols=['modbus', 'tcp'],
                           first_seen=SEEN, last_seen=SEEN))
    db.add(Asset(id=10, user_id=1, name='Recorded PLC', asset_type='plc', serial_number='S-10'))
    db.add(Asset(id=11, user_id=2, name='Private PLC', asset_type='plc', serial_number='S-10'))
    await db.commit()


def test_review_is_read_only_then_exact_promotion_preserves_observation(tmp_path):
    async def scenario():
        async with database(tmp_path / 'review.db') as db:
            await seed(db)
            review = await review_device_promotion(1, current_user=OWNER, db=db)
            assert review['can_promote'] and review['proposed_asset']['name'] == 'Observed PLC'
            assert review['proposed_asset']['criticality'] == 'high'
            assert review['existing_candidate_total'] == 1
            assert [row['id'] for row in review['existing_candidates']] == [10]
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 2
            result = await promote_device_to_asset(1, reviewed_fingerprint=review['reviewed_fingerprint'],
                                                    current_user=OWNER, db=db)
            assert result['device_id'] == 1 and result['asset_name'] == 'Observed PLC'
            assert result['reviewed_fingerprint'] == review['reviewed_fingerprint']
            asset = await db.get(Asset, result['asset_id'])
            assert asset.firmware_version == '4.2' and asset.secondary_protocols == '["tcp"]'
            device = await db.get(DiscoveredDevice, 1)
            assert device.first_seen == SEEN and device.last_seen == SEEN and device.asset_id == asset.id
            with pytest.raises(HTTPException) as error:
                await promote_device_to_asset(1, reviewed_fingerprint=review['reviewed_fingerprint'],
                                               current_user=OWNER, db=db)
            assert error.value.status_code == 409
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 3
    asyncio.run(scenario())


@pytest.mark.parametrize('changed', ['hostname', 'firmware', 'risk', 'new_candidate', 'edited_candidate'])
def test_changed_device_or_duplicate_inventory_invalidates_review(tmp_path, changed):
    async def scenario():
        async with database(tmp_path / f'{changed}.db') as db:
            await seed(db)
            review = await review_device_promotion(1, current_user=OWNER, db=db)
            device = await db.get(DiscoveredDevice, 1)
            if changed == 'hostname':
                device.hostname = 'Changed name'
            elif changed == 'firmware':
                device.firmware_version = '5'
            elif changed == 'risk':
                device.risk_score = 20
            elif changed == 'new_candidate':
                db.add(Asset(id=12, user_id=1, name='Another asset', asset_type='plc', last_known_ip=device.ip_address))
            else:
                (await db.get(Asset, 10)).name = 'Edited record'
            await db.commit()
            with pytest.raises(HTTPException) as error:
                await promote_device_to_asset(1, reviewed_fingerprint=review['reviewed_fingerprint'],
                                               current_user=OWNER, db=db)
            assert error.value.status_code == 409 and device.asset_id is None
    asyncio.run(scenario())


@pytest.mark.parametrize('identity', [2, 999])
def test_foreign_and_missing_devices_do_not_expose_or_create_inventory(tmp_path, identity):
    async def scenario():
        async with database(tmp_path / f'owner-{identity}.db') as db:
            await seed(db)
            db.add(DiscoveredDevice(id=2, user_id=2, ip_address='192.0.2.11', discovery_method='sensor_report'))
            await db.commit()
            for operation in [lambda: review_device_promotion(identity, current_user=OWNER, db=db),
                              lambda: promote_device_to_asset(identity, reviewed_fingerprint='a' * 64,
                                                               current_user=OWNER, db=db)]:
                with pytest.raises(HTTPException) as error:
                    await operation()
                assert error.value.status_code == 404
            assert (await db.execute(select(func.count(Asset.id)))).scalar_one() == 2
    asyncio.run(scenario())


def test_missing_identity_and_unknown_type_produce_valid_inventory_not_none_labels(tmp_path):
    async def scenario():
        async with database(tmp_path / 'fallback.db') as db:
            db.add(DiscoveredDevice(id=1, user_id=1, ip_address='192.0.2.10', discovery_method='sensor_report',
                                   is_ot_device=True, ot_device_type='unrecognized-class', risk_score=None))
            await db.commit()
            review = await review_device_promotion(1, current_user=OWNER, db=db)
            assert review['proposed_asset']['name'] == 'Discovered device 192.0.2.10'
            assert review['proposed_asset']['asset_type'] == 'other_ot'
            assert review['proposed_asset']['criticality'] == 'low'
    asyncio.run(scenario())


def test_candidate_list_is_capped_but_guard_covers_all_matches(tmp_path):
    async def scenario():
        async with database(tmp_path / 'cap.db') as db:
            await seed(db)
            for identity in range(20, 45):
                db.add(Asset(id=identity, user_id=1, name=f'Candidate {identity}',
                             asset_type='plc', serial_number='S-10'))
            await db.commit()
            review = await review_device_promotion(1, current_user=OWNER, db=db)
            assert review['existing_candidate_total'] == 26 and len(review['existing_candidates']) == 20
            (await db.get(Asset, 44)).name = 'Changed beyond visible cap'
            await db.commit()
            with pytest.raises(HTTPException) as error:
                await promote_device_to_asset(1, reviewed_fingerprint=review['reviewed_fingerprint'],
                                               current_user=OWNER, db=db)
            assert error.value.status_code == 409
    asyncio.run(scenario())
