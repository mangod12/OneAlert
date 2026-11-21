"""Stored hunt session reads preserve evidence and owner isolation without execution."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.detection_rule import HuntSession
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'hunt-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            for i, data in [(1, None), (2, {'error': 'foreign'}), (3, []),
                            (99, {'query_results': [{'row_count': 10, 'rows': [{'name': 'retained'}]}],
                                  'error': 'One query rejected'})]:
                db.add(HuntSession(id=i, user_id=2 if i == 2 else 1, hypothesis='Same saved hypothesis',
                                   result_data=data, status='partial', queries_run=2, findings_count=10))
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


@pytest.mark.parametrize('session_id', [1, 3, 99])
def test_exact_owner_saved_evidence_read_never_runs_a_hunt_or_changes_retained_results(client, session_id):
    with patch('backend.services.agents.hunt.HuntAgent.execute', new_callable=AsyncMock) as execute:
        response = client.get(f'/api/v1/hunt/{session_id}')
        assert response.status_code == 200
        row = response.json()
        assert row['id'] == session_id and row['status'] == 'partial'
        assert row['findings_count'] == 10 and row['queries_run'] == 2
        if session_id == 1:
            assert row['result_data'] is None
        elif session_id == 3:
            assert row['result_data'] == []
        else:
            assert row['result_data']['query_results'][0]['row_count'] == 10
            assert len(row['result_data']['query_results'][0]['rows']) == 1
            assert row['result_data']['error'] == 'One query rejected'
        assert client.get(f'/api/v1/hunt/{session_id}').json() == row
        execute.assert_not_called()


@pytest.mark.parametrize('session_id', [2, 404])
def test_other_owners_or_missing_hunt_session_evidence_is_not_disclosed(client, session_id):
    assert client.get(f'/api/v1/hunt/{session_id}').status_code == 404
