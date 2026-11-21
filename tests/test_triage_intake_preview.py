"""Read-only intake matches shared automatic triage selection, without invoking AI."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_active_user
from backend.services.agents.triage import TriageAgent


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'intake.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    stamp = datetime.now(UTC) - timedelta(minutes=10)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Asset(id=1, user_id=1, name='Owned host', asset_type='host'),
                        Case(id=7, user_id=1, title='Existing owned case'),
                        Case(id=8, user_id=9, title='Foreign case')])
            for identity in range(1, 112):
                db.add(Alert(id=identity, user_id=1, asset_id=1, title=f'Owned alert {identity}',
                             severity='high', created_at=stamp))
                if identity <= 10:
                    db.add(CaseAlert(case_id=7, alert_id=identity))
            for identity in range(1, 512):
                db.add(SecurityEvent(id=identity, user_id=1, event_type='dns', signature=f'Event {identity}',
                                     severity='info', timestamp=stamp, processed='pending'))
                if identity <= 10:
                    db.add(CaseEvent(case_id=7, event_id=identity))
            db.add_all([CaseAlert(case_id=8, alert_id=111), CaseEvent(case_id=8, event_id=511),
                        Alert(id=900, user_id=9, asset_id=1, title='Foreign alert', severity='high', created_at=stamp),
                        Alert(id=901, user_id=1, asset_id=1, title='Old alert', severity='high',
                              created_at=stamp - timedelta(days=10)),
                        SecurityEvent(id=900, user_id=9, event_type='dns', timestamp=stamp),
                        SecurityEvent(id=901, user_id=1, event_type='dns', timestamp=stamp, processed='in_case'),
                        SecurityEvent(id=902, user_id=1, event_type='dns', timestamp=stamp - timedelta(days=10))])
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
        with TestClient(app) as client:
            yield client, principal, sessions
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        asyncio.run(engine.dispose())


def test_counts_caps_and_samples_match_actual_shared_selection_without_ai(context):
    client, _, sessions = context
    with patch('backend.services.agents.triage.TriageAgent.execute', new_callable=AsyncMock) as execute:
        result = client.get('/api/v1/cases/triage-intake', params={'hours_back': 72})
        assert result.status_code == 200
        data = result.json()
        execute.assert_not_awaited()
    assert data['hours_back'] == 72 and data['retrieved_at'] and data['cutoff']
    assert data['alerts']['eligible_count'] == 101 and data['events']['eligible_count'] == 501
    assert data['alerts']['batch_count'] == 100 and data['events']['batch_count'] == 500
    assert data['alerts']['deferred_count'] == data['events']['deferred_count'] == 1
    assert [row['id'] for row in data['alerts']['sample']] == list(range(111, 101, -1))
    assert [row['id'] for row in data['events']['sample']] == list(range(511, 501, -1))
    assert 'Foreign' not in str(data) and 'not the full' in data['scope']
    async def selected():
        async with sessions() as db:
            agent = TriageAgent(db=db, user_id=1)
            cutoff = datetime.fromisoformat(data['cutoff'])
            alerts = await agent._get_untriaged_alerts(cutoff)
            events = await agent._get_untriaged_events(cutoff)
            return [row.id for row in alerts], [row.id for row in events]
    alerts, events = asyncio.run(selected())
    assert len(alerts) == 100 and alerts[:10] == [row['id'] for row in data['alerts']['sample']]
    assert len(events) == 500 and events[:10] == [row['id'] for row in data['events']['sample']]
    assert client.get('/api/v1/cases/triage-intake', params={'hours_back': 72}).json()['alerts'] == data['alerts']


def test_other_owner_and_empty_scope_are_isolated(context):
    client, principal, _ = context
    principal['id'] = 2
    result = client.get('/api/v1/cases/triage-intake').json()
    for kind in ['alerts', 'events']:
        assert result[kind]['eligible_count'] == result[kind]['batch_count'] == result[kind]['deferred_count'] == 0
        assert result[kind]['sample'] == []


@pytest.mark.parametrize('hours', [0, 169, 'bad'])
def test_invalid_windows_never_broaden(context, hours):
    assert context[0].get('/api/v1/cases/triage-intake', params={'hours_back': hours}).status_code == 422
