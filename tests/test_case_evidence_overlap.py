"""Exact ID overlap respects both investigations and each evidence owner's scope."""
import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert, CaseEvent, CaseTask, CaseWatcher
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_active_user


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'overlap.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Asset(id=1, user_id=1, name='Owned asset', asset_type='server'),
                        Asset(id=9, user_id=9, name='Foreign asset', asset_type='server'),
                        Case(id=7, user_id=1, title='Source investigation', assigned_to_id=2),
                        Case(id=8, user_id=1, title='Comparison investigation', assigned_to_id=2),
                        Case(id=9, user_id=9, title='Private investigation'),
                        Case(id=10, user_id=9, title='Different owner', assigned_to_id=2),
                        Case(id=11, user_id=1, title='Empty investigation')])
            for case in [7, 8]:
                db.add(CaseWatcher(case_id=case, user_id=3))
                db.add(CaseTask(case_id=case, assignee_id=4, title='Assigned task'))
            for identity in range(100, 113):
                db.add(Alert(id=identity, user_id=1, asset_id=1, title=f'Same label {identity}', severity='high',
                             description='Not part of overlap', created_at=datetime(2026, 1, 1, tzinfo=UTC)))
                db.add(SecurityEvent(id=identity, user_id=1, signature=f'Same label {identity}', event_type='dns',
                                     severity='high', timestamp=datetime(2026, 1, 1, tzinfo=UTC),
                                     raw_data={'excluded': 'payload-not-returned'}))
                for case in ([7] if identity == 111 else [8] if identity == 112 else [7, 8]):
                    db.add(CaseAlert(case_id=case, alert_id=identity))
                    db.add(CaseEvent(case_id=case, event_id=identity))
            db.add_all([Alert(id=900, user_id=9, asset_id=9, title='Private alert', severity='critical'),
                        SecurityEvent(id=900, user_id=9, signature='Private event', event_type='dns',
                                      timestamp=datetime(2026, 1, 1, tzinfo=UTC))])
            for case in [7, 8, 10]:
                for identity in [100, 900, 999]:
                    db.add(CaseAlert(case_id=case, alert_id=identity))
                    db.add(CaseEvent(case_id=case, event_id=identity))
            await db.commit()
    asyncio.run(prepare())
    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    principal = {'id': 1}
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(**principal)
    try:
        with TestClient(app) as value:
            yield value, principal
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        asyncio.run(engine.dispose())


def read(client, **params):
    return client.get('/api/v1/cases/7/evidence-overlap', params={'other_case_id': 8, **params})


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_exact_shared_ids_unique_counts_and_stable_complete_pages(context, kind):
    client, _ = context
    first, second = [read(client, kind=kind, page=page).json() for page in [1, 2]]
    assert first['source_count'] == first['other_count'] == 12
    assert first['shared_count'] == 11 and first['source_only_count'] == first['other_only_count'] == 1
    assert [row['id'] for row in first['records'] + second['records']] == list(range(110, 99, -1))
    assert all(row['can_open_original'] for row in first['records'])
    assert 'Private' not in str(first) and '999' not in str(first) and 'payload-not-returned' not in str(first)
    assert first['retrieved_at'] and 'not text similarity' in first['scope']
    assert read(client, kind=kind, page=3).json()['records'] == []
    assert read(client, kind=kind).json()['records'] == first['records']


@pytest.mark.parametrize('principal_id', [2, 3, 4])
def test_assignees_watchers_and_task_assignees_keep_visibility_but_not_direct_links(context, principal_id):
    client, principal = context
    principal['id'] = principal_id
    result = read(client).json()
    assert result['shared_count'] == 11
    assert all(not row['can_open_original'] for row in result['records'])


@pytest.mark.parametrize('other_case_id', [9, 999])
def test_private_or_missing_comparison_is_indistinguishable(context, other_case_id):
    client, _ = context
    response = read(client, other_case_id=other_case_id)
    assert response.status_code == 404 and response.json()['error']['message'] == 'Investigation not found'


def test_source_visibility_and_both_owner_scopes_are_required(context):
    client, principal = context
    principal['id'] = 2
    result = read(client, other_case_id=10).json()
    assert result['source_count'] == 12 and result['other_count'] == 1 and result['shared_count'] == 0
    assert not result['records'] and 'Private alert' not in str(result)
    principal['id'] = 5
    assert read(client).status_code == 404


def test_empty_comparison_and_self_id_are_honest(context):
    client, _ = context
    result = read(client, other_case_id=11).json()
    assert result['source_count'] == 12 and result['other_count'] == result['shared_count'] == 0
    assert result['source_only_count'] == 12 and not result['records']
    assert read(client, other_case_id=7).status_code == 422


@pytest.mark.parametrize('params', [{'kind': 'raw'}, {'page': 0}, {'size': 101},
                                   {'other_case_id': 0}, {'other_case_id': 2147483648}])
def test_query_bounds(context, params):
    assert read(context[0], **params).status_code == 422
