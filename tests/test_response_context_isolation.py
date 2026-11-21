"""Malformed links cannot feed another tenant's alerts/assets into response planning."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.services.agents.response import ResponseAgent


@pytest.mark.asyncio
@pytest.mark.parametrize('broken_link', ['foreign_alert', 'foreign_asset', 'missing_alert', 'missing_asset'])
async def test_unavailable_context_is_private_and_requires_review(tmp_path, monkeypatch, broken_link):
    from backend.services.agents import response
    provider = SimpleNamespace(model='local-test', complete_json=AsyncMock(return_value={
        'actions': [{'action_type': 'block_ip', 'target': '192.0.2.7', 'reason': 'Review containment'}],
    }))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _: provider)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'context-scope.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add_all([Case(id=7, user_id=1, title='Owned case', severity='high'),
                        Asset(id=1, user_id=1, name='Owned IT asset', asset_type='host',
                              network_zone='it', is_ot_asset=False),
                        Asset(id=9, user_id=9, name='private-asset-name', asset_type='private-type',
                              network_zone='private-zone', primary_protocol='private-protocol', is_ot_asset=False),
                        Alert(id=1, user_id=1, asset_id=1, title='Owned alert', severity='high'),
                        Alert(id=9, user_id=9, asset_id=9, title='private-alert-title', severity='high'),
                        CaseAlert(case_id=7, alert_id=1)])
            if broken_link == 'foreign_alert':
                reference = 9
            elif broken_link == 'missing_alert':
                reference = 999
            else:
                reference = 2
                db.add(Alert(id=2, user_id=1, asset_id=9 if broken_link == 'foreign_asset' else 999,
                             title='Owned alert without usable asset', severity='high'))
            db.add(CaseAlert(case_id=7, alert_id=reference))
            await db.commit()
            result = await ResponseAgent(db=db, user_id=1).run(case_id=7, autonomy_level='L4')
            messages = provider.complete_json.call_args.args[0]
            sent = str([message.content for message in messages])
            assert 'Owned alert' in sent and 'Owned IT asset' in sent
            assert 'private-alert-title' not in sent and 'private-asset-name' not in sent
            assert 'private-type' not in sent and 'private-zone' not in sent and 'private-protocol' not in sent
            assert 'unavailable' in sent
            assert result['needs_approval'] and result['status'] == 'pending_approval'
            policy = result['actions'][0]['policy_check']
            assert not policy['approved'] and policy['requires_human'] and policy['assessed_context_count'] == 2
    finally:
        await engine.dispose()
