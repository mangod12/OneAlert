"""Generated plans must preserve all linked OT restrictions instead of picking a first zone."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.models.user import User
from backend.services.agents.response import ResponseAgent


@pytest.mark.asyncio
@pytest.mark.parametrize('zones', [[('it', False), ('field', True)], [('field', True), ('it', False)],
                                  [('it', False), ('supervisory', True)]])
async def test_saved_plan_requires_approval_for_any_linked_restricted_ot_context(tmp_path, monkeypatch, zones):
    from backend.services.agents import response
    provider = SimpleNamespace(model='test-local', complete_json=AsyncMock(return_value={
        'actions': [{'action_type': 'block_ip', 'target': '192.0.2.4', 'reason': 'Review containment'}],
        'rationale': 'Test response',
    }))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _task: provider)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'ot-policy.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add(User(id=1, email='policy-owner@example.test'))
            await db.flush()
            case = Case(user_id=1, title='Mixed linked assets', severity='high')
            db.add(case)
            await db.flush()
            for index, (zone, is_ot) in enumerate(zones):
                asset = Asset(user_id=1, name=f'asset-{index}', asset_type='host', network_zone=zone, is_ot_asset=is_ot)
                db.add(asset)
                await db.flush()
                alert = Alert(user_id=1, asset_id=asset.id, title='Recorded alert', severity='high')
                db.add(alert)
                await db.flush()
                db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
            await db.commit()
            result = await ResponseAgent(db=db, user_id=1).run(case_id=case.id, autonomy_level='L4')
            assert result['needs_approval'] is True
            assert result['status'] == 'pending_approval'
            saved = await db.get(ResponsePlan, result['plan_id'])
            assert saved.actions[0]['policy_check']['approved'] is False
            assert saved.actions[0]['policy_check']['assessed_context_count'] == 2
            approval = (await db.execute(
                select(ApprovalRequest).where(ApprovalRequest.plan_id == saved.id)
            )).scalar_one()
            assert approval.status == 'pending'
            assert 'execution_result' not in saved.actions[0]
    finally:
        await engine.dispose()
