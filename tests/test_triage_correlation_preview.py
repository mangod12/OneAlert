"""Preview uses real bounded triage selection and correlation without running an agent."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import AgentRun, Case
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_active_user
from backend.services.agents.triage import TriageAgent


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'correlation-preview.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(UTC) - timedelta(minutes=1)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            for index in range(1, 13):
                db.add(Asset(id=index, user_id=1, name=f'Asset {index}', asset_type='host'))
                db.add(Alert(id=index, user_id=1, asset_id=index, title=f'Owned alert {index}',
                             severity='high', created_at=now))
            # Newest-first events form 2 independent clusters then a late info bridge merges them.
            db.add_all([SecurityEvent(id=identity, user_id=1, timestamp=now, event_type='auth', signature=label,
                                      severity=severity, source_ip=source, dest_ip=destination)
                        for identity, source, destination, severity, label in [
                            (3, 'a', 'b', 'high', 'First cluster'), (2, 'c', 'd', 'high', 'Second cluster'),
                            (1, 'b', 'c', 'info', 'Late bridge'), (4, 'z', None, 'info', 'Excluded info')]])
            db.add_all([SecurityEvent(user_id=9, timestamp=now, event_type='auth', severity='high',
                                      source_ip='a', signature='Foreign'),
                        SecurityEvent(user_id=1, timestamp=now + timedelta(days=2), event_type='auth',
                                      severity='high', source_ip='a', signature='Future')])
            await db.commit()
    asyncio.run(prepare())
    async def database():
        async with sessions() as db:
            yield db
    principal = {'id': 1}
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(**principal)
    with TestClient(app) as client:
        yield client, principal, sessions
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old)
    asyncio.run(engine.dispose())


def test_complete_group_pages_match_real_selection_and_transitive_correlation_without_ai_or_writes(context):
    client, _, sessions = context
    with patch.object(TriageAgent, 'execute', new_callable=AsyncMock) as execute, patch(
            'backend.services.agents.triage.get_ai_provider') as provider:
        first = client.get('/api/v1/cases/triage-correlation').json()
        second = client.get('/api/v1/cases/triage-correlation', params={'page': 2}).json()
        execute.assert_not_awaited()
        provider.assert_not_called()
    assert first['groups_total'] == second['groups_total'] == 13
    assert first['alerts_selected'] == 12 and first['events_selected'] == 4
    assert first['events_excluded_info_only'] == 1
    assert len(first['records']) == 10 and len(second['records']) == 3
    groups = [*first['records'], *second['records']]
    assert [row['position'] for row in groups] == list(range(1, 14))
    assert all(row['basis'] == 'shared_asset' for row in groups[:12])
    component = groups[-1]
    assert component['basis'] == 'shared_ip_component' and component['event_count'] == 3
    assert [row['id'] for row in component['event_sample']] == [3, 2, 1]
    assert component['event_ai_input_count'] == 3
    assert 'Foreign' not in str(groups) and 'Future' not in str(groups) and 'Excluded info' not in str(groups)
    assert client.get('/api/v1/cases/triage-correlation', params={'page': 3}).json()['records'] == []
    async def verify():
        async with sessions() as db:
            agent = TriageAgent(db, 1)
            cutoff, until = datetime.fromisoformat(first['cutoff']), datetime.fromisoformat(first['retrieved_at'])
            alerts = await agent._get_untriaged_alerts(cutoff, until=until)
            events = await agent._get_untriaged_events(cutoff, until=until)
            actual = agent._group_by_correlation(alerts, events)
            assert [(len(row['alerts']), len(row['events'])) for row in actual] == [
                (row['alert_count'], row['event_count']) for row in groups]
            for model in [AgentRun, Case]:
                assert (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0
            assert (await db.execute(select(func.count()).select_from(SecurityEvent).where(
                SecurityEvent.processed == 'in_case'))).scalar_one() == 0
    asyncio.run(verify())


def test_empty_other_owner_cannot_preview_private_groups(context):
    client, principal, _ = context
    principal['id'] = 2
    data = client.get('/api/v1/cases/triage-correlation').json()
    assert data['groups_total'] == data['alerts_selected'] == data['events_selected'] == 0
    assert data['records'] == []


@pytest.mark.parametrize('params', [{'hours_back': 0}, {'hours_back': 169}, {'page': 0}, {'page': 'bad'}])
def test_invalid_scope_is_rejected(context, params):
    assert context[0].get('/api/v1/cases/triage-correlation', params=params).status_code == 422


def test_group_metadata_samples_are_bounded_and_ai_input_caps_are_not_full_group_review(context, monkeypatch):
    client, _, _ = context
    alerts = [SimpleNamespace(id=index, title=f'Alert {index}', severity='high', created_at=None)
              for index in range(1, 101)]
    events = [SimpleNamespace(id=index, signature=f'Event {index}', severity='high', timestamp=None,
                              source_ip='a', dest_ip='b') for index in range(1, 501)]
    monkeypatch.setattr(TriageAgent, '_get_untriaged_alerts', AsyncMock(return_value=alerts))
    monkeypatch.setattr(TriageAgent, '_get_untriaged_events', AsyncMock(return_value=events))
    monkeypatch.setattr(TriageAgent, '_group_by_correlation', lambda *args: [
        {'alerts': alerts, 'events': [], 'ips': set()}, {'alerts': [], 'events': events, 'ips': {'a', 'b'}}])
    data = client.get('/api/v1/cases/triage-correlation').json()
    assert data['records'][0]['alert_count'] == 100 and data['records'][0]['alert_ai_input_count'] == 20
    assert data['records'][1]['event_count'] == 500 and data['records'][1]['event_ai_input_count'] == 50
    assert len(data['records'][0]['alert_sample']) == 3 and len(data['records'][1]['event_sample']) == 5
