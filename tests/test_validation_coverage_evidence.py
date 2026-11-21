"""Simulation and unknown outcomes must not be laundered into live coverage."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.validation import ControlResult, ValidationRun, ValidationStep
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'coverage-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([ValidationRun(id=i, user_id=2 if i == 3 else 1, name=f'Run {i}',
                                      status='failed' if i == 2 else 'completed', mode='dry_run')
                        for i in (1, 2, 3)])
            for i, run, simulated, technique, name in [
                (1, 1, True, 'T1059', 'Command'), (2, 1, False, 'T1059', 'Command'),
                (3, 1, True, 'T1059', 'Command'), (4, 1, True, 'T1046', 'No controls'),
                (5, 2, True, 'T1059', 'Command'), (6, 3, True, 'T1059', 'Foreign'),
                (7, 1, True, 'T1059', 'Renamed command'),
            ]:
                db.add(ValidationStep(id=i, run_id=run, step_number=i, technique_id=technique,
                                      technique_name=name, test_name=f'Step {i}', simulated=simulated))
            for i, step, detected in [(1, 1, True), (2, 1, False), (3, 2, True), (4, 3, True),
                                      (5, 5, False), (6, 6, True)]:
                db.add(ControlResult(id=i, step_id=step, control_name=f'Control {i}',
                                     control_type='manual', detected=detected))
            await db.commit()
            await db.execute(update(ValidationStep).where(ValidationStep.id == 3).values(simulated=None))
            await db.execute(update(ControlResult).where(ControlResult.id == 4).values(detected=None))
            await db.commit()
    asyncio.run(prepare())

    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        asyncio.run(engine.dispose())


def read(client, **params):
    response = client.get('/api/v1/validation/coverage-evidence', params=params)
    assert response.status_code == 200
    return response.json()


def test_owner_scope_unknown_outcomes_and_counts_are_not_duplicate_steps(client):
    result = read(client)
    assert result['run_status'] == 'completed' and result['execution'] == 'all' and result['total'] == 3
    command = next(row for row in result['techniques'] if row['technique_name'] == 'Command')
    assert command == {
        'technique_id': 'T1059', 'technique_name': 'Command', 'run_count': 1, 'step_count': 3,
        'simulated_steps': 1, 'non_simulated_steps': 1, 'unknown_execution_steps': 1,
        'control_result_count': 4, 'recorded_detected': 2, 'recorded_not_detected': 1,
        'unknown_outcomes': 1, 'recorded_detection_percentage': 66.7,
    }
    assert not any(row['technique_name'] == 'Foreign' for row in result['techniques'])
    assert result['retrieved_at'] and 'not independent proof' in result['scope']


def test_no_control_results_are_retained_without_inventing_a_zero_detection_rate(client):
    row = read(client)['techniques'][0]
    assert row['technique_id'] == 'T1046' and row['step_count'] == 1
    assert row['control_result_count'] == row['recorded_detected'] == row['unknown_outcomes'] == 0
    assert row['recorded_detection_percentage'] is None


def test_execution_filters_and_run_status_never_change_records(client):
    assert read(client, execution='simulated')['techniques'][1]['step_count'] == 1
    non_simulated = read(client, execution='non_simulated')['techniques']
    assert len(non_simulated) == 1 and non_simulated[0]['recorded_detected'] == 1
    unknown = read(client, execution='unknown')['techniques']
    assert len(unknown) == 1 and unknown[0]['unknown_outcomes'] == 1
    assert unknown[0]['recorded_detection_percentage'] is None
    failed = read(client, run_status='failed')['techniques']
    assert len(failed) == 1 and failed[0]['recorded_not_detected'] == 1
    all_runs = next(row for row in read(client, run_status='all')['techniques'] if row['technique_name'] == 'Command')
    assert all_runs['run_count'] == 2 and all_runs['step_count'] == 4 and all_runs['recorded_not_detected'] == 2
    assert read(client, run_status='pending')['techniques'] == []
    assert read(client)['total'] == 3


def test_group_names_are_distinct_and_paging_is_stable(client):
    first, second, third = [read(client, size=1, page=page) for page in (1, 2, 3)]
    assert first['techniques'][0]['technique_id'] == 'T1046'
    assert second['techniques'][0]['technique_name'] == 'Command'
    assert third['techniques'][0]['technique_name'] == 'Renamed command'
    assert read(client, size=1, page=4)['techniques'] == []


@pytest.mark.parametrize('params', [
    {'size': 0}, {'size': 101}, {'page': 0}, {'page': 1000001},
    {'execution': 'live'}, {'run_status': 'invented'},
])
def test_invalid_scope_is_rejected(client, params):
    assert client.get('/api/v1/validation/coverage-evidence', params=params).status_code == 422


def sources(client, **params):
    response = client.get('/api/v1/validation/coverage-evidence/steps', params={
        'technique_id': 'T1059', 'technique_name': 'Command', **params,
    })
    assert response.status_code == 200
    return response.json()


def test_source_steps_reconcile_group_without_duplicate_steps_or_foreign_records(client):
    result = sources(client)
    assert result['total'] == 3
    assert [row['step_id'] for row in result['records']] == [1, 2, 3]
    assert all(row['run_id'] == 1 for row in result['records'])
    group = next(row for row in read(client)['techniques'] if row['technique_name'] == 'Command')
    for key in ['control_result_count', 'recorded_detected', 'recorded_not_detected', 'unknown_outcomes']:
        assert sum(row[key] for row in result['records']) == group[key]
    assert result['records'][0]['control_result_count'] == 2
    assert result['records'][2]['simulated'] is None
    assert result['records'][2]['unknown_outcomes'] == 1
    assert result['technique_name'] == 'Command' and result['retrieved_at']
    assert 'not proof' in result['scope']


def test_source_steps_exact_groups_empty_controls_and_execution_status_filters(client):
    assert [row['step_id'] for row in sources(client, technique_name='Renamed command')['records']] == [7]
    assert sources(client, technique_name='Foreign')['records'] == []
    assert sources(client, technique_name='command')['records'] == []
    assert sources(client, technique_name="Command' OR 1=1 --")['total'] == 0
    assert [row['step_id'] for row in sources(client, execution='simulated')['records']] == [1]
    assert [row['step_id'] for row in sources(client, execution='non_simulated')['records']] == [2]
    assert [row['step_id'] for row in sources(client, execution='unknown')['records']] == [3]
    failed = sources(client, run_status='failed')['records']
    assert [row['step_id'] for row in failed] == [5] and failed[0]['run_status'] == 'failed'
    assert sources(client, run_status='all')['total'] == 4
    assert sources(client, run_status='pending')['total'] == 0
    row = sources(client, technique_id='T1046', technique_name='No controls')['records'][0]
    assert row['control_result_count'] == row['unknown_outcomes'] == 0
    assert row['actual_result'] is None and row['executed_at'] is None


def test_source_steps_database_pages_are_stable_and_empty_beyond_end(client):
    assert [sources(client, size=1, page=page)['records'][0]['step_id'] for page in (1, 2, 3)] == [1, 2, 3]
    assert sources(client, size=1, page=4)['records'] == []
    assert sources(client, size=1)['total'] == 3


@pytest.mark.parametrize('params', [
    {'size': 0}, {'size': 101}, {'page': 0}, {'page': 1000001},
    {'execution': 'live'}, {'run_status': 'invented'}, {'technique_id': ''},
    {'technique_id': 'X' * 201}, {'technique_name': 'X' * 1001},
])
def test_source_steps_validate_parameters(client, params):
    assert client.get('/api/v1/validation/coverage-evidence/steps', params={
        'technique_id': 'T1059', 'technique_name': 'Command', **params,
    }).status_code == 422
