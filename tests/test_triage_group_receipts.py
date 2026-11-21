"""Saved outcomes retain bounded source IDs, including rejected and rolled-back groups."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import AgentRun, AgentStep, Case
from backend.services.agents.triage import TriageAgent
from backend.services.triage_group_receipt import group_outcome_receipt


@pytest.mark.parametrize('method', ['ai_sample', 'rule_based_fallback', 'unavailable'])
def test_largest_bounded_receipt_survives_500_character_ledger_without_cutting_ids(method):
    group = {'alerts': [SimpleNamespace(id=9_223_372_036_854_775_807 - index) for index in range(100)],
             'events': [SimpleNamespace(id=9_223_372_036_854_775_807 - index) for index in range(500)]}
    text = group_outcome_receipt(group, 600, 'failed' if method == 'unavailable' else 'case_created',
                                 None if method == 'unavailable' else 9_223_372_036_854_775_807, method)
    data = json.loads(text)
    assert len(text) <= 500 and len(data['alert_sample_ids']) == 3 and len(data['event_sample_ids']) == 5
    assert data['alert_inputs'] == (20 if method == 'ai_sample' else 100 if method == 'rule_based_fallback' else None)
    assert data['event_inputs'] == (50 if method == 'ai_sample' else 500 if method == 'rule_based_fallback' else None)


def test_failure_never_claims_completed_analysis_coverage_and_oversize_fails_closed():
    group = {'alerts': [SimpleNamespace(id=1)], 'events': []}
    data = json.loads(group_outcome_receipt(group, 1, 'failed', method='ai_sample'))
    assert data['method'] == 'unavailable' and data['alert_inputs'] is None and data['event_inputs'] is None
    with pytest.raises(ValueError, match='exceeds'):
        group_outcome_receipt(group, 1, 'case_created', case_id=int('9' * 500), method='ai_sample')


@pytest.mark.asyncio
async def test_saved_nonincident_fallback_case_and_invalid_ai_decision_are_distinct(tmp_path, monkeypatch):
    from backend.services.agents import triage
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'group-receipts.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Asset(id=index, user_id=1, name=f'Asset {index}', asset_type='host') for index in range(1, 4)])
            db.add_all([Alert(id=index, user_id=1, asset_id=index, title=f'Alert {index}', severity='high')
                        for index in range(1, 4)])
            await db.commit()
            provider = SimpleNamespace(model='unit-test', complete_json=AsyncMock(side_effect=[
                {'is_incident': False}, RuntimeError('Unavailable'), {'is_incident': 'false'}]))
            monkeypatch.setattr(triage, 'get_ai_provider', lambda _: provider)
            result = await TriageAgent(db, 1).execute()
            assert result['status'] == 'partial' and result['cases_created'] == 1
            assert result['groups_nonincident'] == result['groups_failed'] == 1
        async with sessions() as db:
            run = (await db.execute(select(AgentRun))).scalar_one()
            steps = (await db.execute(select(AgentStep).where(AgentStep.action == 'triage_group_outcome')
                                      .order_by(AgentStep.step_number))).scalars().all()
            receipts = [json.loads(step.output_summary) for step in steps]
            assert [row['position'] for row in receipts] == [1, 2, 3]
            assert [row['outcome'] for row in receipts] == ['nonincident', 'case_created', 'failed']
            assert [row['method'] for row in receipts] == ['ai_sample', 'rule_based_fallback', 'unavailable']
            assert [row['alert_sample_ids'] for row in receipts] == [[3], [2], [1]]
            assert receipts[0]['case_id'] is receipts[2]['case_id'] is None
            case = (await db.execute(select(Case))).scalar_one()
            assert receipts[1]['case_id'] == case.id
            assert receipts[2]['alert_inputs'] is None and run.status == 'partial'
            assert all(len(step.output_summary) <= 500 for step in steps)
    finally:
        await engine.dispose()
