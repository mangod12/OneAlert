"""A failed group rolls back its writes while healthy groups and the run ledger survive."""
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import AgentRun, AgentStep, Case, CaseAlert, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.services.agents.triage import TriageAgent


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['late_exception', 'database_constraint', 'receipt_write'])
@pytest.mark.parametrize('all_failed', [False, True])
async def test_group_write_failure_is_atomic_and_next_group_still_commits(tmp_path, monkeypatch, failure, all_failed):
    from backend.services.agents import triage
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'atomic.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            records = [SecurityEvent(id=identity, user_id=1, timestamp=datetime.now(UTC), event_type='auth',
                                     severity='high', source_ip=f'10.0.0.{identity}', processed='pending')
                       for identity in [1, 2]]
            alerts = [Alert(id=identity, user_id=1, asset_id=identity,
                            title=f'Synthetic alert {identity}', severity='high') for identity in [1, 2]]
            db.add_all([Asset(id=identity, user_id=1, name=f'Asset {identity}', asset_type='server')
                        for identity in [1, 2]])
            db.add_all([*records, *alerts])
            await db.commit()
            payloads = [{'is_incident': True, 'title': f'Candidate {identity}',
                         'attack_narrative': 'fail-this-group' if identity == 1 or all_failed else 'valid-analysis'}
                        for identity in [1, 2]]
            provider = SimpleNamespace(model='test', complete_json=AsyncMock(side_effect=payloads))
            monkeypatch.setattr(triage, 'get_ai_provider', lambda _: provider)
            agent = TriageAgent(db, 1)
            agent._get_untriaged_alerts = AsyncMock(return_value=alerts)
            agent._get_untriaged_events = AsyncMock(return_value=records)
            agent._group_by_correlation = MagicMock(return_value=[
                {'alerts': [alert], 'events': [record]} for alert, record in zip(alerts, records, strict=True)])
            original_log = agent.log_step
            if failure in ('late_exception', 'receipt_write'):
                async def log_step(action, *args, **kwargs):
                    await original_log(action, *args, **kwargs)
                    fail_case = (action == 'create_case' and failure == 'late_exception'
                                 and ('Candidate 1' in kwargs['output_summary'] or all_failed))
                    receipt = json.loads(kwargs['output_summary']) if action == 'triage_group_outcome' else None
                    fail_receipt = (receipt is not None and failure == 'receipt_write'
                                    and receipt['outcome'] == 'case_created'
                                    and (receipt['position'] == 1 or all_failed))
                    if fail_case or fail_receipt:
                        raise RuntimeError('Failed after case, evidence and timeline flush')
                agent.log_step = log_step
            else:
                @event.listens_for(db.sync_session, 'before_flush')
                def invalidate_analysis(session, *_):
                    for row in session.new:
                        if isinstance(row, CaseTimeline) and row.content == 'fail-this-group':
                            row.content = None  # Actual NOT NULL violation, not a mocked execute error.
            result = await agent.execute()
            assert result['status'] == ('failed' if all_failed else 'partial')
            assert result['groups_failed'] == (2 if all_failed else 1)
            expected = 0 if all_failed else 1
            assert result['cases_created'] == result['events_triaged'] == result['alerts_triaged'] == expected
        async with sessions() as db:
            cases = (await db.execute(select(Case))).scalars().all()
            links = (await db.execute(select(CaseEvent))).scalars().all()
            ledger = (await db.execute(select(AgentRun))).scalar_one()
            saved_events = (await db.execute(select(SecurityEvent).order_by(SecurityEvent.id))).scalars().all()
            assert ledger.status == result['status'] and ledger.completed_at is not None
            failure_steps = (await db.execute(
                select(AgentStep).where(AgentStep.action == 'group_failed'))).scalars().all()
            receipts = [json.loads(step.output_summary) for step in (await db.execute(select(AgentStep).where(
                AgentStep.action == 'triage_group_outcome').order_by(AgentStep.step_number))).scalars().all()]
            assert [row['outcome'] for row in receipts] == (['failed', 'failed'] if all_failed else
                                                           ['failed', 'case_created'])
            assert receipts[0]['alert_sample_ids'] == receipts[0]['event_sample_ids'] == [1]
            assert receipts[0]['case_id'] is receipts[0]['alert_inputs'] is receipts[0]['event_inputs'] is None
            assert receipts[0]['method'] == 'unavailable'
            assert len(failure_steps) == result['groups_failed']
            assert all('rolled back' in step.output_summary for step in failure_steps)
            assert len(cases) == len(links) == (0 if all_failed else 1)
            assert saved_events[0].processed == 'pending'
            assert saved_events[1].processed == ('pending' if all_failed else 'in_case')
            assert (await db.execute(select(func.count()).select_from(CaseAlert))).scalar_one() == expected
            timelines = (await db.execute(select(CaseTimeline))).scalars().all()
            assert len(timelines) == (0 if all_failed else 1)
            if not all_failed:
                assert cases[0].title == 'Candidate 2' and links[0].event_id == 2
                assert timelines[0].content == 'valid-analysis'
    finally:
        await engine.dispose()
