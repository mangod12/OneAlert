"""Sequential stage results name their exact ledger records, even after failed stages."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.case import AgentRun
from backend.routers.cases import auto_triage
from backend.services.agents.detect import DetectAgent
from backend.services.agents.orchestrator import run_pipeline
from backend.services.agents.triage import TriageAgent


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['none', 'detect', 'triage', 'both'])
async def test_pipeline_records_exact_owned_stage_runs_and_preserves_failure_outcomes(tmp_path, monkeypatch, failure):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pipeline-runs.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add(AgentRun(id=99, user_id=9, agent_type='triage', status='completed'))
            await db.commit()
            for kind, cls in [('detect', DetectAgent), ('triage', TriageAgent)]:
                fails = failure in (kind, 'both')
                monkeypatch.setattr(cls, 'run', AsyncMock(
                    side_effect=RuntimeError('stage failed') if fails else None,
                    return_value={'status': 'completed', 'summary': 'Saved result'}))
            result = await run_pipeline(db, user_id=1, hours_back=72)
            assert result['hours_back'] == 72
            assert result['run_ids']['detect'] != result['run_ids']['triage']
            assert result['pipeline_status'] == ('completed' if failure == 'none' else
                                                  'failed' if failure == 'both' else 'partial')
            for kind, run_id in result['run_ids'].items():
                saved = (await db.execute(select(AgentRun).where(AgentRun.id == run_id))).scalar_one()
                assert saved.user_id == 1 and saved.agent_type == kind
                assert saved.status == ('failed' if failure in (kind, 'both') else 'completed')
                assert saved.completed_at is not None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_triage_endpoint_exposes_its_own_run_not_the_global_latest(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'triage-run.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            monkeypatch.setattr(TriageAgent, 'run', AsyncMock(return_value={
                'status': 'partial', 'summary': 'One group failed', 'groups_failed': 1}))
            response = await auto_triage(hours_back=72, current_user=SimpleNamespace(id=1), db=db)
            row = await db.get(AgentRun, response['data']['run_id'])
            assert row.user_id == 1 and row.agent_type == 'triage' and row.status == 'partial'
            assert response['data']['groups_failed'] == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_missing_recorded_stage_run_is_not_inferred_from_other_records(monkeypatch):
    monkeypatch.setattr(DetectAgent, 'execute', AsyncMock(return_value={'summary': 'Done'}))
    monkeypatch.setattr(TriageAgent, 'execute', AsyncMock(return_value={'summary': 'Done'}))
    result = await run_pipeline(MagicMock(), 1)
    assert result['run_ids'] == {'detect': None, 'triage': None}
