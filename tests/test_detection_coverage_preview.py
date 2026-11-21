"""Preview uses the detector's owner-scoped, bounded aggregate without AI or writes."""
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
from backend.models.case import AgentRun, Case
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_active_user
from backend.services.agents.detect import DetectAgent


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'detect-preview.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            records = [SecurityEvent(user_id=1, timestamp=now - timedelta(hours=1), event_type='alert',
                                     severity='high', source_ip='10.0.0.1', dest_port=502,
                                     signature='Synthetic OT activity', processed='in_case') for _ in range(60)]
            records += [SecurityEvent(user_id=1, timestamp=now - timedelta(hours=2), event_type='dns',
                                      severity='info', source_ip=f'host-{index:02}', dest_port=1000 + index,
                                      signature=f'signature-{index:02}') for index in range(25)]
            records += [SecurityEvent(user_id=owner, timestamp=stamp, event_type='alert', severity='critical',
                                      signature=label) for owner, stamp, label in [
                                          (9, now - timedelta(hours=1), 'Foreign'),
                                          (1, now - timedelta(hours=200), 'Old'),
                                          (1, now + timedelta(seconds=1), 'Future')]]
            # Both recorded-time boundaries are inclusive.
            records += [SecurityEvent(user_id=1, timestamp=stamp, event_type='dns', severity='low')
                        for stamp in [now, now - timedelta(hours=24)]]
            db.add_all(records)
            await db.commit()
    asyncio.run(prepare())
    async def database():
        async with sessions() as db:
            yield db
    principal = {'id': 1}
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(**principal)
    with patch('backend.routers.triage_intake.datetime', Clock), TestClient(app) as client:
        yield client, principal, sessions, now
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    asyncio.run(engine.dispose())


def test_bounded_read_matches_actual_detector_caps_ties_rules_and_owner_scope_without_ai_or_writes(context):
    client, _, sessions, now = context
    with patch('backend.services.agents.detect.get_ai_provider') as provider, patch.object(
            DetectAgent, 'execute', new_callable=AsyncMock) as execute:
        response = client.get('/api/v1/cases/detection-preview')
        assert response.status_code == 200
        data = response.json()
        provider.assert_not_called()
        execute.assert_not_awaited()
    assert data['hours_back'] == 24 and data['total_events'] == 87 and data['alert_events'] == 60
    assert data['severity_distribution'] == {'high': 60, 'info': 25, 'low': 2}
    assert data['ai_eligible'] is True
    assert len(data['top_sources']) == len(data['top_ports']) == 20 and len(data['top_signatures']) == 10
    assert data['top_sources'][0] == {'label': '10.0.0.1', 'count': 60}
    assert [row['label'] for row in data['top_sources'][1:]] == [f'host-{index:02}' for index in range(19)]
    assert data['top_ports'][0] == {'label': '502', 'count': 60}
    assert len(data['rule_findings']) == 3
    assert all(word not in str(data) for word in ['Foreign', 'Old', 'Future'])
    async def verify():
        async with sessions() as db:
            agent = DetectAgent(db, 1)
            stats = await agent._aggregate_events(now - timedelta(hours=24), until=now)
            assert stats['total_events'] == data['total_events']
            assert agent._rule_based_detection(stats) == data['rule_findings']
            for model in [AgentRun, Case]:
                assert (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0
            assert (await db.execute(select(func.count()).select_from(SecurityEvent).where(
                SecurityEvent.processed == 'in_case'))).scalar_one() == 60
    asyncio.run(verify())


def test_empty_owner_and_longer_window_are_not_broadened_to_other_owners(context):
    client, principal, _, _ = context
    principal['id'] = 2
    data = client.get('/api/v1/cases/detection-preview', params={'hours_back': 168}).json()
    assert data['total_events'] == data['alert_events'] == 0 and data['ai_eligible'] is False
    assert all(not data[field] for field in ['top_sources', 'top_ports', 'top_signatures', 'rule_findings'])
    principal['id'] = 1
    assert client.get('/api/v1/cases/detection-preview', params={'hours_back': 1}).json()['total_events'] == 61


@pytest.mark.parametrize('hours', [0, 169, 'bad'])
def test_invalid_window_is_rejected(context, hours):
    assert context[0].get('/api/v1/cases/detection-preview', params={'hours_back': hours}).status_code == 422
