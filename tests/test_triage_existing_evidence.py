"""Serial automatic triage does not create repeated cases for linked saved evidence."""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case, CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.services.agents.triage import TriageAgent


@pytest.mark.asyncio
async def test_owned_links_exclude_before_limits_but_foreign_or_orphan_links_do_not(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'triage-existing.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        now = datetime.now(UTC)
        async with sessions() as db:
            db.add_all([Asset(id=1, user_id=1, name='Owned host', asset_type='host'),
                        Case(id=7, user_id=1, title='Already triaged', status='closed'),
                        Case(id=8, user_id=9, title='Foreign case')])
            for identity in range(1, 106):
                db.add(Alert(id=identity, user_id=1, asset_id=1, title=f'Alert {identity}',
                             severity='high', created_at=now))
                db.add(SecurityEvent(id=identity, user_id=1, event_type='dns', severity='high',
                                     timestamp=now, processed='pending'))
                if identity >= 5:
                    db.add(CaseAlert(case_id=7, alert_id=identity))
                    db.add(CaseEvent(case_id=7, event_id=identity))
            db.add_all([CaseAlert(case_id=8, alert_id=1), CaseEvent(case_id=8, event_id=1),
                        CaseAlert(case_id=999, alert_id=2), CaseEvent(case_id=999, event_id=2),
                        Alert(id=900, user_id=9, asset_id=1, title='Foreign alert', severity='high', created_at=now),
                        SecurityEvent(id=900, user_id=9, event_type='dns', severity='high', timestamp=now),
                        Alert(id=901, user_id=1, asset_id=1, title='Old alert', severity='high',
                              created_at=now - timedelta(days=3)),
                        SecurityEvent(id=901, user_id=1, event_type='dns', severity='high',
                                      timestamp=now - timedelta(days=3))])
            await db.commit()
            agent = TriageAgent(db=db, user_id=1)
            cutoff = now - timedelta(days=1)
            assert [a.id for a in await agent._get_untriaged_alerts(cutoff)] == [4, 3, 2, 1]
            assert [e.id for e in await agent._get_untriaged_events(cutoff)] == [4, 3, 2, 1]
            # A deliberate unlink makes that saved record eligible again; no hidden processed flag is invented.
            await db.execute(delete(CaseAlert).where(CaseAlert.case_id == 7, CaseAlert.alert_id == 105))
            await db.execute(delete(CaseEvent).where(CaseEvent.case_id == 7, CaseEvent.event_id == 105))
            await db.commit()
            assert (await agent._get_untriaged_alerts(cutoff))[0].id == 105
            assert (await agent._get_untriaged_events(cutoff))[0].id == 105
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_second_serial_run_skips_already_linked_alert_without_another_ai_request(tmp_path, monkeypatch):
    from backend.services.agents import triage
    provider = SimpleNamespace(model='local-test', complete_json=AsyncMock(return_value={
        'is_incident': True, 'title': 'Recorded investigation', 'summary': 'Review evidence',
        'severity': 'high', 'confidence': 0.8, 'attack_narrative': 'Saved synthetic analysis',
    }))
    monkeypatch.setattr(triage, 'get_ai_provider', lambda _: provider)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'triage-repeat.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add(Asset(id=1, user_id=1, name='Owned host', asset_type='host'))
            db.add(Alert(id=1, user_id=1, asset_id=1, title='Owned alert', severity='high',
                         created_at=datetime.now(UTC)))
            await db.commit()
            first = await TriageAgent(db=db, user_id=1).run()
            await db.commit()
            second = await TriageAgent(db=db, user_id=1).run()
            assert first['cases_created'] == first['alerts_triaged'] == 1
            assert second['cases_created'] == second['alerts_triaged'] == 0
            provider.complete_json.assert_awaited_once()
            assert (await db.execute(select(func.count()).select_from(Case))).scalar_one() == 1
            assert (await db.execute(select(func.count()).select_from(CaseAlert))).scalar_one() == 1
    finally:
        await engine.dispose()
