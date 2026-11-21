"""Exact briefing reads are private, stable identifiers and never invoke AI."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app  # noqa: F401
from backend.models.case import AgentRun, Case, CaseTimeline
from backend.routers.case_reports import get_briefing


@pytest_asyncio.fixture
async def exact_db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'exact.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add_all([Case(id=1, user_id=1, title='Owned'), Case(id=2, user_id=1, title='Other owned'),
                    Case(id=3, user_id=2, title='Foreign')])
        for n in range(1, 10):
            db.add(CaseTimeline(id=n, case_id=1, entry_type='ai_analysis', source='agent', content='Saved draft',
                metadata_json={'format': 'onealert-case-briefing', 'version': 1, 'case_id': 1, 'marker': n}))
        db.add(CaseTimeline(id=20, case_id=3, entry_type='ai_analysis', source='agent', content='Foreign draft',
            metadata_json={'format': 'onealert-case-briefing', 'version': 1, 'case_id': 3}))
        db.add(CaseTimeline(id=21, case_id=1, entry_type='note', source='human', content='Not a draft',
            metadata_json={'format': 'onealert-case-briefing', 'version': 1, 'case_id': 1}))
        await db.commit()
        yield db
    await engine.dispose()


@pytest.mark.asyncio
async def test_exact_older_draft_is_not_substituted_with_latest_and_does_not_generate(exact_db, monkeypatch):
    from backend.services.agents.report import ReportAgent
    execute = AsyncMock()
    monkeypatch.setattr(ReportAgent, 'execute', execute)
    result = await get_briefing(1, 1, SimpleNamespace(id=1), exact_db)
    assert result['case_id'] == 1 and result['record']['timeline_id'] == 1
    assert result['record']['briefing']['marker'] == 1 and result['retrieved_at']
    execute.assert_not_called()
    assert (await exact_db.execute(select(func.count()).select_from(AgentRun))).scalar_one() == 0
    assert (await exact_db.execute(select(func.count()).select_from(CaseTimeline))).scalar_one() == 11


@pytest.mark.asyncio
@pytest.mark.parametrize('case_id,draft_id,user_id', [(1, 999, 1), (1, 20, 1), (3, 20, 1),
    (2, 1, 1), (999, 1, 1), (1, 1, 2), (1, 21, 1)])
async def test_missing_foreign_wrong_case_or_non_draft_ids_are_404(exact_db, case_id, draft_id, user_id):
    with pytest.raises(HTTPException) as exc:
        await get_briefing(case_id, draft_id, SimpleNamespace(id=user_id), exact_db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, {}, [], {'format': 'onealert-case-briefing', 'version': 2, 'case_id': 1},
    {'format': 'onealert-case-briefing', 'version': 1, 'case_id': 2}])
async def test_unverifiable_saved_metadata_is_not_reported_as_this_draft(exact_db, value):
    row = await exact_db.get(CaseTimeline, 1)
    row.metadata_json = value
    await exact_db.commit()
    with pytest.raises(HTTPException) as exc:
        await get_briefing(1, 1, SimpleNamespace(id=1), exact_db)
    assert exc.value.status_code == 404
