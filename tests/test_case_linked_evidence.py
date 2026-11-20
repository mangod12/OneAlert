"""Read-only complete case evidence retains collaboration and hides malformed owner references."""
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
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'linked-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Asset(id=1, user_id=9, name='Private correlated asset', asset_type='server'),
                        Asset(id=2, user_id=1, name='Owned correlated asset', asset_type='server'),
                        Case(id=7, user_id=1, assigned_to_id=2, title='Saved investigation', status='open'),
                        Case(id=8, user_id=9, title='Private investigation', status='open'),
                        CaseWatcher(case_id=7, user_id=3),
                        CaseTask(case_id=7, assignee_id=4, title='Assigned task')])
            for index in range(25):
                identity = 100 + index
                severity = 'critical' if index == 0 else 'high'
                label = 'Old 100%_literal' if index == 0 else f'Linked {index}'
                db.add(Alert(id=identity, user_id=1, asset_id=2 if identity == 101 else 1, title=f'{label} alert',
                             description='Saved alert description', cve_id='CVE-2099-0100' if index == 0 else None,
                             severity=severity, status='resolved', created_at=datetime(2026, 1, 1, tzinfo=UTC)))
                db.add(SecurityEvent(id=identity, user_id=1, event_type='dns', signature=f'{label} event',
                                     severity=severity, timestamp=datetime(2026, 1, 1, tzinfo=UTC),
                                     source_ip='10.0.0.7', dest_ip=None, raw_data={'not_exported': 'raw content'}))
                db.add_all([CaseAlert(case_id=7, alert_id=identity), CaseEvent(case_id=7, event_id=identity)])
            db.add_all([Alert(id=900, user_id=9, asset_id=1, title='Private foreign alert', severity='high'),
                        SecurityEvent(id=900, user_id=9, event_type='private', signature='Private foreign event',
                                      source_ip='203.0.113.9',
                                      timestamp=datetime(2026, 1, 1, tzinfo=UTC)),
                        CaseAlert(case_id=7, alert_id=100), CaseEvent(case_id=7, event_id=100),
                        CaseAlert(case_id=7, alert_id=900), CaseEvent(case_id=7, event_id=900),
                        CaseAlert(case_id=7, alert_id=999), CaseEvent(case_id=7, event_id=999)])
            await db.commit()
    asyncio.run(prepare())
    async def db_override():
        async with sessions() as db:
            yield db
    principal = {'id': 1}
    app.dependency_overrides[get_async_db] = db_override
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(**principal)
    with TestClient(app) as client:
        yield client, principal
    app.dependency_overrides.clear()
    asyncio.run(engine.dispose())


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_complete_stable_paged_distinct_records_and_unavailable_references(context, kind):
    client, _ = context
    pages = [client.get('/api/v1/cases/7/linked-evidence', params={'kind': kind, 'page': page}).json()
             for page in [1, 2, 3]]
    assert all(data['available_count'] == data['total'] == 25 for data in pages)
    assert all(data['unavailable_reference_count'] == 2 for data in pages)
    rows = [row for data in pages for row in data['records']]
    assert [row['id'] for row in rows] == list(range(124, 99, -1))
    assert all(row['can_open_original'] for row in rows)
    assert 'Private' not in str(pages) and 'raw content' not in str(pages)
    for route in ['alerts', 'events']:
        legacy = client.get(f'/api/v1/cases/7/{route}').json()
        assert len(legacy) == 25 and 'Private' not in str(legacy)


@pytest.mark.parametrize('principal_id', [2, 3, 4])
def test_existing_assignment_watcher_and_task_visibility_is_preserved_without_original_access(context, principal_id):
    client, principal = context
    principal['id'] = principal_id
    data = client.get('/api/v1/cases/7/linked-evidence', params={'kind': 'event'}).json()
    assert data['total'] == 25 and all(not row['can_open_original'] for row in data['records'])
    principal['id'] = 5
    assert client.get('/api/v1/cases/7/linked-evidence', params={'kind': 'event'}).status_code == 404
    principal['id'] = 1
    assert client.get('/api/v1/cases/8/linked-evidence', params={'kind': 'event'}).status_code == 404


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_literal_search_exact_id_and_severity_only_narrow_available_linked_records(context, kind):
    client, _ = context
    url = '/api/v1/cases/7/linked-evidence'
    for search in [' 100%_LITERAL ', '100']:
        data = client.get(url, params={'kind': kind, 'search': search, 'severity': 'critical'}).json()
        assert data['total'] == 1 and data['records'][0]['id'] == 100
        assert data['available_count'] == 25 and data['search'] == search.strip()
    assert client.get(url, params={'kind': kind, 'search': 'Private'}).json()['total'] == 0
    assert client.get(url, params={'kind': kind, 'search': 'missing'}).json()['records'] == []
    assert client.get(url, params={'kind': kind, 'page': 99}).json()['records'] == []
    field = 'CVE-2099-0100' if kind == 'alert' else '10.0.0.7'
    assert client.get(url, params={'kind': kind, 'search': field}).json()['total'] == (1 if kind == 'alert' else 25)


@pytest.mark.parametrize('params', [{}, {'kind': 'wrong'}, {'kind': 'event', 'page': 0},
                                   {'kind': 'event', 'size': 101}, {'kind': 'alert', 'search': 'x' * 201},
                                   {'kind': 'alert', 'severity': 'urgent'}])
def test_invalid_scope_cannot_browse(context, params):
    client, _ = context
    assert client.get('/api/v1/cases/7/linked-evidence', params=params).status_code == 422


def test_current_blast_graph_cannot_reveal_unrelated_owner_evidence_or_asset_details(context):
    client, _ = context
    result = client.get('/api/v1/cases/7/blast-radius')
    assert result.status_code == 200
    data = result.json()['data']
    assert 'Private correlated asset' not in str(data) and '203.0.113.9' not in str(data)
    assert 'Owned correlated asset' in str(data) and '10.0.0.7' in str(data)
