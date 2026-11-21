"""Hunts reopen their exact owned run and terminal failures do not look like empty success."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.case import AgentRun
from backend.models.detection_rule import HuntSession
from backend.routers.auth import get_active_user
from backend.services.agents.hunt import HuntAgent


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'hunt-continuity.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            for identity, owner, kind in [(1, 1, 'hunt'), (2, 2, 'hunt'), (3, 1, 'triage')]:
                db.add(AgentRun(id=identity, user_id=owner, agent_type=kind, status='completed'))
            for identity, run_id in [(10, 1), (11, 2), (12, 3), (13, '1'), (14, 999), (15, True)]:
                db.add(HuntSession(id=identity, user_id=1, hypothesis='Same old hypothesis', status='completed',
                                   result_data={'agent_run_id': run_id, 'query_results': []}))
            db.add(HuntSession(id=16, user_id=2, hypothesis='Foreign hunt', result_data={'agent_run_id': 2}))
            await db.commit()
    asyncio.run(prepare())
    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    with TestClient(app) as client:
        yield client, sessions
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old)
    asyncio.run(engine.dispose())


def test_reopening_uses_only_exact_owned_hunt_run_and_never_executes(context, monkeypatch):
    client, _ = context
    execute = AsyncMock()
    monkeypatch.setattr(HuntAgent, 'execute', execute)
    assert client.get('/api/v1/hunt/10').json()['result_data']['agent_run_id'] == 1
    for identity in [11, 12, 13, 14, 15]:
        assert client.get(f'/api/v1/hunt/{identity}').json()['result_data']['agent_run_id'] is None
    assert client.get('/api/v1/hunt/16').status_code == 404
    assert client.get('/api/v1/hunt/999').status_code == 404
    execute.assert_not_awaited()


@pytest.mark.parametrize('status', ['completed', 'partial', 'failed'])
def test_new_hunt_preserves_actual_outcomes_with_exact_run_link(context, monkeypatch, status):
    client, sessions = context
    result = {'status': status, 'summary': 'Retained outcome', 'query_results': [],
              'execution_summary': {'attempted': 0, 'completed': 0, 'failed': 0, 'rejected': 0, 'skipped': 0}}
    monkeypatch.setattr(HuntAgent, 'run', AsyncMock(return_value=result))
    data = client.post('/api/v1/hunt/', json={'hypothesis': 'Review gateway'}).json()['data']
    assert data['status'] == status and data['agent_run_id'] > 3
    reopened = client.get(f"/api/v1/hunt/{data['session_id']}").json()
    assert reopened['result_data']['agent_run_id'] == data['agent_run_id']
    assert reopened['result_data']['execution_summary'] == result['execution_summary']
    async def inspect():
        async with sessions() as db:
            row = await db.get(AgentRun, data['agent_run_id'])
            assert row.agent_type == 'hunt' and row.status == status
    asyncio.run(inspect())


def test_terminal_exception_saves_failed_session_and_run_without_fake_empty_query_summary(context, monkeypatch):
    client, sessions = context
    monkeypatch.setattr(HuntAgent, 'run', AsyncMock(side_effect=RuntimeError('private failure details')))
    response = client.post('/api/v1/hunt/', json={'hypothesis': 'Review failed gateway hunt'})
    assert response.status_code == 200
    data = response.json()['data']
    assert data['status'] == 'failed' and data['agent_run_id'] > 3
    assert 'execution_summary' not in data and 'query_results' not in data
    assert 'private failure details' not in str(data)
    assert 'not a zero-finding result' in data['error']
    reopened = client.get(f"/api/v1/hunt/{data['session_id']}").json()
    assert reopened['status'] == 'failed' and reopened['result_data']['agent_run_id'] == data['agent_run_id']
    history = client.get('/api/v1/hunt/history', params={'state': 'running'}).json()
    assert all(row['id'] != data['session_id'] for row in history['sessions'])
    async def inspect():
        async with sessions() as db:
            session = await db.get(HuntSession, data['session_id'])
            run = await db.get(AgentRun, data['agent_run_id'])
            assert session.completed_at is not None and run.status == 'failed'
            assert run.error_message == 'private failure details'
    asyncio.run(inspect())


@pytest.mark.parametrize('hypothesis', ['', '   ', 'x' * 4001])
def test_invalid_hypothesis_creates_no_session_or_run(context, monkeypatch, hypothesis):
    client, sessions = context
    execute = AsyncMock()
    monkeypatch.setattr(HuntAgent, 'execute', execute)
    assert client.post('/api/v1/hunt/', json={'hypothesis': hypothesis}).status_code == 422
    execute.assert_not_awaited()
    async def inspect():
        async with sessions() as db:
            assert len((await db.execute(select(AgentRun))).scalars().all()) == 3
    asyncio.run(inspect())
