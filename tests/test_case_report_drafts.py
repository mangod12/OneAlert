"""Report drafts preserve bounded owned references and never execute a response."""
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.main import app
from backend.models.alert import Alert
from backend.models.case import AgentRun, AgentStep, Case, CaseAlert, CaseEvent, CaseTimeline
from backend.models.security_event import SecurityEvent
from backend.routers.case_reports import generate_briefing, list_briefings
from backend.services.agents import report as module


@pytest_asyncio.fixture
async def report_db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'reports.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([Case(id=1, user_id=1, title='Recorded case', summary='saved summary', status='open'),
                    Case(id=2, user_id=2, title='Foreign case')])
        await db.commit()
        yield db
    await engine.dispose()


def valid_report():
    return {'observations': [{'text': 'The case has a recorded summary.', 'sources': ['case:1']}],
            'gaps': ['The metadata does not prove compromise.'], 'review_questions': ['Is more evidence needed?']}


@pytest.mark.asyncio
async def test_saved_report_has_exact_run_receipt_and_no_case_or_security_mutation(report_db, monkeypatch):
    db = report_db
    provider = SimpleNamespace(model='test-model', complete_json=AsyncMock(return_value=valid_report()))
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: provider)
    result = (await generate_briefing(1, SimpleNamespace(id=1), db))['data']
    report = result['briefing']
    assert result['status'] == 'completed' and report['mode'] == 'ai_draft'
    run = await db.get(AgentRun, report['run_id'])
    assert run.user_id == 1 and run.agent_type == 'report' and run.status == 'completed'
    assert run.model_used == 'test-model'
    saved = await db.get(CaseTimeline, result['timeline_id'])
    assert saved.metadata_json == report and saved.entry_type == 'ai_analysis'
    assert (await db.get(Case, 1)).status == 'open'
    assert (await db.get(Case, 1)).summary == 'saved summary'
    assert (await db.execute(select(func.count()).select_from(AgentStep))).scalar_one() == 2
    listed = await list_briefings(1, None, SimpleNamespace(id=1), db)
    assert listed['records'][0]['briefing'] == report
    assert listed['next_before_id'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('case_id', [2, 999])
async def test_report_create_and_history_hide_foreign_or_missing_cases(report_db, monkeypatch, case_id):
    provider = AsyncMock()
    monkeypatch.setattr(module, 'get_ai_provider', provider)
    for fn, args in [(generate_briefing, (case_id, SimpleNamespace(id=1), report_db)),
                     (list_briefings, (case_id, None, SimpleNamespace(id=1), report_db))]:
        with pytest.raises(HTTPException) as exc:
            await fn(*args)
        assert exc.value.status_code == 404
    provider.assert_not_called()
    assert (await report_db.execute(select(func.count()).select_from(AgentRun))).scalar_one() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', ['unavailable', 'foreign_reference', 'oversized', 'invalid_shape'])
async def test_bad_ai_does_not_become_successful_or_uncited_report(report_db, monkeypatch, bad):
    value = valid_report()
    if bad == 'foreign_reference':
        value['observations'][0]['sources'] = ['event:999']
    if bad == 'oversized':
        value['observations'][0]['text'] = 'x' * 401
    if bad == 'invalid_shape':
        value = []
    provider = SimpleNamespace(model='test', complete_json=AsyncMock(
        side_effect=RuntimeError('private provider error') if bad == 'unavailable' else None, return_value=value))
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: provider)
    result = await module.ReportAgent(report_db, 1).execute(case_id=1)
    assert result['status'] == 'partial' and result['briefing']['mode'] == 'recorded_metadata_fallback'
    assert result['briefing']['observations'][0]['sources'] == ['case:1']
    assert 'private provider error' not in str(result)
    assert (await report_db.get(AgentRun, result['briefing']['run_id'])).status == 'partial'


@pytest.mark.asyncio
async def test_context_is_bounded_metadata_and_owner_scoped_even_for_malformed_links(report_db, monkeypatch):
    db = report_db
    now = datetime.now(UTC)
    for n in range(1, 24):
        db.add(Alert(id=n, user_id=1, asset_id=1, title='a' * 500, severity='high', description='RAW-SECRET'))
        db.add(CaseAlert(case_id=1, alert_id=n))
    for n in range(1, 54):
        db.add(SecurityEvent(id=n, user_id=1, event_type='auth', timestamp=now, signature='e' * 500,
                             raw_data={'secret': 'RAW-SECRET'}))
        db.add(CaseEvent(case_id=1, event_id=n))
    db.add_all([Alert(id=100, user_id=2, asset_id=2, title='FOREIGN-SECRET', severity='high'),
                CaseAlert(case_id=1, alert_id=100)])
    await db.commit()
    provider = SimpleNamespace(model='test', complete_json=AsyncMock(return_value=valid_report()))
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: provider)
    result = await module.ReportAgent(db, 1).execute(case_id=1)
    scope = result['briefing']['scope']
    assert scope['alert'] == {'linked': 24, 'available': 23, 'included': 20, 'omitted': 3, 'unavailable': 1,
                              'limit': 20}
    assert scope['event']['included'] == 50 and scope['event']['omitted'] == 3
    context = provider.complete_json.call_args.args[0][1].content
    assert 'RAW-SECRET' not in context and 'FOREIGN-SECRET' not in context
    assert all(len(row.get('label', '')) <= 400 for row in result['briefing']['sources'])


@pytest.mark.asyncio
async def test_history_cursor_does_not_repeat_pages_or_include_other_analysis(report_db, monkeypatch):
    db = report_db
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: SimpleNamespace(
        model='test', complete_json=AsyncMock(return_value=valid_report())))
    ids = []
    for _ in range(7):
        result = await module.ReportAgent(db, 1).execute(case_id=1)
        ids.append(result['timeline_id'])
    db.add(CaseTimeline(case_id=1, entry_type='ai_analysis', content='other', source='agent', metadata_json={}))
    await db.commit()
    page = await list_briefings(1, None, SimpleNamespace(id=1), db)
    assert [row['timeline_id'] for row in page['records']] == ids[::-1][:5]
    older = await list_briefings(1, page['next_before_id'], SimpleNamespace(id=1), db)
    assert [row['timeline_id'] for row in older['records']] == ids[:2][::-1]
    assert older['next_before_id'] is None


@pytest.mark.asyncio
async def test_failure_saving_receipt_rolls_back_draft_and_records_failed_run(report_db, monkeypatch):
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: SimpleNamespace(
        model='test', complete_json=AsyncMock(return_value=valid_report())))
    original = module.ReportAgent.log_step
    async def fail_receipt(self, action, **kwargs):
        if action == 'saved_report_draft':
            raise RuntimeError('Cannot save receipt')
        return await original(self, action, **kwargs)
    monkeypatch.setattr(module.ReportAgent, 'log_step', fail_receipt)
    with pytest.raises(RuntimeError, match='Cannot save receipt'):
        await module.ReportAgent(report_db, 1).execute(case_id=1)
    assert (await report_db.execute(select(func.count()).select_from(CaseTimeline))).scalar_one() == 0
    assert (await report_db.execute(select(AgentRun.status))).scalar_one() == 'failed'


@pytest.mark.asyncio
async def test_http_generation_and_saved_history_do_not_create_response_or_checklist_work(report_db, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from backend.database.db import get_async_db
    from backend.models.case import CaseTask
    from backend.models.response_plan import ApprovalRequest, ResponsePlan
    from backend.routers.auth import get_active_user
    monkeypatch.setattr(module, 'get_ai_provider', lambda _: SimpleNamespace(
        model='test', complete_json=AsyncMock(return_value=valid_report())))
    async def database():
        yield report_db
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/cases/1/briefing-drafts', json={
                'execute': True, 'status': 'approved', 'case_id': 2, 'sources': ['event:999']})
            assert response.status_code == 200
            data = response.json()['data']
            assert data['briefing']['case_id'] == 1
            history = await client.get('/api/v1/cases/1/briefing-drafts')
            assert history.status_code == 200
            assert history.json()['records'][0]['timeline_id'] == data['timeline_id']
            assert (await client.get('/api/v1/cases/1/briefing-drafts?before_id=0')).status_code == 422
            assert (await client.post('/api/v1/cases/2/briefing-drafts')).status_code == 404
        for model in [CaseTask, ApprovalRequest, ResponsePlan]:
            assert (await report_db.execute(select(func.count()).select_from(model))).scalar_one() == 0
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.mark.parametrize('field,value', [
    ('observations', []), ('observations', [{'text': 'x', 'sources': []}]),
    ('observations', [{'text': 'x', 'sources': [True]}]),
    ('observations', [{'text': 'x', 'sources': ['case:1'] * 6}]),
    ('gaps', ['x'] * 7), ('gaps', ['x' * 401]), ('review_questions', 'not a list'),
])
def test_report_validator_rejects_unbounded_or_uncited_output(field, value):
    payload = valid_report()
    payload[field] = value
    with pytest.raises(ValueError):
        module.validate_report(payload, {'case:1'})
