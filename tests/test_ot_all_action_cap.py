"""Every registered response action respects the Purdue 0-3 L2 ceiling."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert
from backend.services.action_executor import ACTION_HANDLERS
from backend.services.agents.response import ResponseAgent
from backend.services.policy_engine import (
    ALWAYS_REQUIRE_APPROVAL,
    ASSET_SCOPE_ACTIONS,
    AUTONOMY_LEVELS,
    check_action_approval,
)


def test_every_registered_noncommunication_action_has_an_asset_scope_guard():
    assert set(ACTION_HANDLERS) - {'notify', 'ticket'} <= ASSET_SCOPE_ACTIONS


@pytest.mark.parametrize('level', ['L3', 'L4'])
@pytest.mark.parametrize('zone', ['field', 'control', 'supervisory', ' SAFETY_SYSTEM '])
@pytest.mark.parametrize('action', sorted(ACTION_HANDLERS))
def test_restricted_ot_never_autoapproves_actions_beyond_l2(action, zone, level):
    policy = check_action_approval(action, level, zone, True)
    expected = action in AUTONOMY_LEVELS['L2']['auto_approve']
    assert policy['approved'] is expected and policy['requires_human'] is not expected
    if not expected:
        assert 'maximum autonomy L2' in policy['reason']


@pytest.mark.parametrize('action', sorted(ASSET_SCOPE_ACTIONS))
@pytest.mark.parametrize('context', [(None, True), ('unknown', True), ('field', None), (None, None)])
def test_unavailable_classification_or_ot_zone_requires_review_for_all_asset_scoped_actions(action, context):
    policy = check_action_approval(action, 'L4', *context)
    assert policy['approved'] is False and policy['requires_human'] is True


@pytest.mark.parametrize('action', sorted(ACTION_HANDLERS))
def test_known_non_ot_keeps_its_existing_l4_policy(action):
    policy = check_action_approval(action, 'L4', 'it', False)
    expected = action in AUTONOMY_LEVELS['L4']['auto_approve'] and action not in ALWAYS_REQUIRE_APPROVAL
    assert policy['approved'] is expected


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['block_domain', 'revoke_token', 'snapshot_logs', 'preserve_pcap'])
async def test_saved_response_plan_requires_review_for_previously_uncovered_ot_actions(tmp_path, monkeypatch, action):
    from backend.services.agents import response
    provider = SimpleNamespace(model='unit-test', complete_json=AsyncMock(return_value={
        'actions': [{'action_type': action, 'target': 'review-required-target', 'reason': 'Review proposed action'}],
    }))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _: provider)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'ot-actions.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add_all([Case(id=7, user_id=1, title='OT case', severity='high'),
                        Asset(id=1, user_id=1, name='Field controller', asset_type='host',
                              network_zone='field', is_ot_asset=True),
                        Alert(id=1, user_id=1, asset_id=1, title='Owned alert', severity='high'),
                        CaseAlert(case_id=7, alert_id=1)])
            await db.commit()
            result = await ResponseAgent(db, 1).run(case_id=7, autonomy_level='L4')
            assert result['status'] == 'pending_approval' and result['needs_approval'] is True
            assert result['actions'][0]['policy_check']['approved'] is False
            assert 'execution_result' not in result['actions'][0]
    finally:
        await engine.dispose()
