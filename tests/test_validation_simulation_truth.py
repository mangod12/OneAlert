"""New validation plans never manufacture control observations or detection rates."""
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.case import AgentRun, AgentStep
from backend.models.validation import ControlResult, ValidationRun, ValidationStep
from backend.routers.validation import execute_validation_run
from backend.services.agents.purple import ATOMIC_TESTS, PurpleAgent


@pytest_asyncio.fixture
async def plan_db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'plans.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        yield db
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['dry_run', 'lab'])
async def test_both_allowed_modes_save_only_unmeasured_simulations_with_exact_ledger_receipt(plan_db, mode):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Simulation plan', mode=mode, mitre_techniques=['T1110', 'T1059']))
    await db.commit()
    response = await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert response['success'] and 'not measured' in response['data']['summary']
    vrun = await db.get(ValidationRun, 1)
    summary = vrun.results_summary
    assert summary['measurement_mode'] == 'simulation_only'
    assert summary['simulated_tests'] == 3 and summary['tested'] == summary['detected'] == summary['missed'] == 0
    assert summary['detection_rate'] is None
    run = await db.get(AgentRun, summary['agent_run_id'])
    assert run.agent_type == 'purple' and run.user_id == 1 and run.status == 'completed'
    steps = (await db.execute(select(ValidationStep).order_by(ValidationStep.step_number))).scalars().all()
    assert len(steps) == 3
    for step in steps:
        assert step.simulated is True and step.actual_result == 'simulated_unmeasured'
        assert step.executed_at is None and step.test_type == 'simulation_plan'
        assert step.evidence['command_executed'] is step.evidence['detection_measured'] is False
        assert step.command.startswith('[NOT EXECUTED, SIMULATION PLAN]')
        assert step.duration_ms >= 0
    assert (await db.execute(select(func.count()).select_from(ControlResult))).scalar_one() == 0
    actions = (await db.execute(select(AgentStep.action))).scalars().all()
    assert actions.count('prepare_simulation_step') == 3
    assert 'execute_test' not in actions


@pytest.mark.asyncio
@pytest.mark.parametrize('mode,approved', [('production', None), ('production', 1), ('unexpected', 1)])
async def test_live_or_unknown_execution_is_blocked_even_with_an_approval_field(plan_db, mode, approved):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Blocked', mode=mode, approved_by=approved,
                         mitre_techniques=['T1110']))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert exc.value.status_code == 403
    assert (await db.get(ValidationRun, 1)).status == 'pending'
    assert (await db.execute(select(func.count()).select_from(AgentRun))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(ValidationStep))).scalar_one() == 0
    direct = await PurpleAgent(db, 1).execute(run_id=1)
    assert direct['error'] and (await db.get(ValidationRun, 1)).status == 'pending'


@pytest.mark.asyncio
@pytest.mark.parametrize('techniques', [[], ['T9999'], ['T1110', 'T9999'], ['T1110'] * 101])
async def test_no_zero_test_success_or_silent_unsupported_techniques(plan_db, techniques):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Invalid', mitre_techniques=techniques))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert exc.value.status_code == 422
    assert (await db.get(ValidationRun, 1)).results_summary is None
    assert (await db.execute(select(func.count()).select_from(AgentRun))).scalar_one() == 0


@pytest.mark.asyncio
async def test_source_run_techniques_and_mode_cannot_be_replaced_by_invocation_kwargs(plan_db):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Owned', mode='lab', mitre_techniques=['T1110', 'T1110']))
    await db.commit()
    result = await PurpleAgent(db, 1).execute(run_id=1, mode='production', techniques=['T9999'])
    assert result['results']['simulated_tests'] == len(ATOMIC_TESTS['T1110']['tests'])
    assert (await db.execute(select(ValidationStep.simulated))).scalar_one() is True


@pytest.mark.asyncio
async def test_saved_failed_steps_are_not_overwritten_or_appended_on_retry(plan_db):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Previous evidence', status='failed', mitre_techniques=['T1110']))
    db.add(ValidationStep(run_id=1, step_number=1, technique_id='T1110', technique_name='Old', test_name='Old evidence',
                          simulated=False, actual_result='error'))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert exc.value.status_code == 409
    result = await PurpleAgent(db, 1).execute(run_id=1)
    assert 'Saved evidence' in result['error']
    assert (await db.execute(select(ValidationStep.test_name))).scalar_one() == 'Old evidence'


@pytest.mark.asyncio
async def test_foreign_owner_cannot_start_or_inspect_a_simulation_by_guessing_id(plan_db):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=2, name='Foreign', mitre_techniques=['T1110']))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert exc.value.status_code == 404
    result = await PurpleAgent(db, 1).execute(run_id=1)
    assert result['error'] == 'Validation run not found'
    assert (await db.get(ValidationRun, 1)).status == 'pending'


@pytest.mark.asyncio
async def test_failed_plan_receipt_rolls_back_partial_steps_and_leaves_a_terminal_failure(plan_db, monkeypatch):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Atomic failure', mitre_techniques=['T1110']))
    await db.commit()
    original = PurpleAgent.log_step
    async def failed_receipt(self, action, *args, **kwargs):
        if action == 'complete_simulation_plan':
            raise RuntimeError('Cannot save plan receipt')
        return await original(self, action, *args, **kwargs)
    monkeypatch.setattr(PurpleAgent, 'log_step', failed_receipt)
    with pytest.raises(RuntimeError):
        await PurpleAgent(db, 1).execute(run_id=1)
    assert (await db.execute(select(func.count()).select_from(ValidationStep))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(ControlResult))).scalar_one() == 0
    assert (await db.get(ValidationRun, 1)).status == 'failed'
    assert (await db.get(ValidationRun, 1)).results_summary is None
    assert (await db.execute(select(AgentRun.status))).scalar_one() == 'failed'


@pytest.mark.asyncio
async def test_failed_summary_without_steps_is_still_preserved_as_evidence(plan_db):
    db = plan_db
    db.add(ValidationRun(id=1, user_id=1, name='Prior summary', status='failed', mitre_techniques=['T1110'],
                         results_summary={'legacy': 'retained'}))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await execute_validation_run(1, SimpleNamespace(id=1), db)
    assert exc.value.status_code == 409
    assert (await db.get(ValidationRun, 1)).results_summary == {'legacy': 'retained'}
