"""Detection receipts survive exact run reads without inventing evidence or actions."""
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.case import AgentRun, AgentStep, Case
from backend.models.security_event import SecurityEvent
from backend.routers.cases import get_agent_run
from backend.services.agents.detect import DetectAgent
from backend.services.detection_receipt import build_detection_receipt

FINDING = {'title': 'Generated candidate', 'description': 'Review the original event; this is not confirmed activity.',
           'severity': 'high', 'affected_ips': ['192.0.2.1'], 'recommended_actions': ['Review saved telemetry'],
           'indicators': ['unconfirmed']}


def test_receipt_bounds_text_lists_and_findings_without_altering_original():
    now = datetime.now(UTC)
    finding = {**FINDING, 'title': '😀' * 300, 'description': 'D' * 1000,
               'affected_ips': ['X' * 100] * 12, 'recommended_actions': ['A' * 400] * 8}
    receipt = build_detection_receipt(3, now, now, {'total_events': 80, 'alert_events': 8},
                                      [finding] * 22, [finding] * 21, 'completed')
    assert receipt['included'] == 30 and receipt['omitted'] == 13
    assert receipt['rule_count'] == 22 and receipt['ai_count'] == 21
    assert [row['method'] for row in receipt['findings']] == ['rule'] * 22 + ['ai'] * 8
    row = receipt['findings'][0]
    assert len(row['title']) == 160 and len(row['description']) == 800
    assert len(row['affected_ips']) == 10 and all(len(ip) == 64 for ip in row['affected_ips'])
    assert len(row['recommended_actions']) == 5 and all(len(action) == 240 for action in row['recommended_actions'])
    assert len(finding['title']) == 300 and len(finding['affected_ips']) == 12
    assert 'not event-level evidence' in receipt['scope'] and 'may be shortened' in receipt['scope']


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['completed', 'failed', 'empty'])
async def test_execute_persists_owned_exact_receipt_without_security_mutations(tmp_path, mode):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'detection-receipts.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            now = datetime.now(UTC)
            db.add(AgentRun(id=500, user_id=9, agent_type='detect', status='completed'))
            records = [SecurityEvent(user_id=1, timestamp=now - timedelta(minutes=1),
                                     event_type='alert', severity='high', source_ip='192.0.2.1', dest_port=502)
                       for _ in range(60 if mode != 'empty' else 0)]
            records.extend([SecurityEvent(user_id=owner, timestamp=stamp, event_type='alert', severity='critical')
                            for owner, stamp in [(9, now), (1, now + timedelta(days=1)),
                                                 (1, now - timedelta(days=3))]])
            db.add_all(records)
            await db.commit()
            agent = DetectAgent(db, 1)
            agent._llm_analysis = AsyncMock(side_effect=RuntimeError('unavailable') if mode == 'failed' else None,
                                            return_value=[FINDING])
            result = await agent.execute(hours_back=24)
            detail = await get_agent_run(run_id=agent._run.id, current_user=SimpleNamespace(id=1), db=db)
            step = next(step for step in detail.steps if step.action == 'detection_review_receipt')
            receipt = json.loads(step.output_summary)
            assert receipt['run_id'] == detail.id != 500
            assert receipt['total_events'] == (0 if mode == 'empty' else 60)
            assert receipt['window_from'] < receipt['window_until']
            assert receipt['included'] == len(result['findings'])
            assert receipt['ai_status'] == ('skipped' if mode == 'empty' else mode)
            assert detail.status == ('partial' if mode == 'failed' else 'completed')
            assert len(step.output_summary) > 500  # Generic summary truncation must not corrupt this receipt.
            if mode == 'completed':
                assert receipt['findings'][-1]['method'] == 'ai'
                assert receipt['findings'][-1]['description'] == FINDING['description']
            if mode == 'empty':
                agent._llm_analysis.assert_not_awaited()
                assert receipt['findings'] == []
            with pytest.raises(HTTPException) as denied:
                await get_agent_run(run_id=agent._run.id, current_user=SimpleNamespace(id=9), db=db)
            assert denied.value.status_code == 404
            for model in [Case, Alert]:
                assert (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0
            assert (await db.execute(select(func.count(SecurityEvent.id)))).scalar_one() == len(records)
            assert (await db.execute(select(func.count(AgentStep.id)).where(
                AgentStep.action == 'detection_review_receipt'))).scalar_one() == 1
    finally:
        await engine.dispose()
