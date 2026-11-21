"""Case-scoped draft generation never approves, simulates or executes a response."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.case import AgentRun, AgentStep, Case
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.routers.auth import get_active_user
from backend.services.agents.response import ResponseAgent


@pytest.fixture
def context(tmp_path, monkeypatch):
    from backend.services.agents import response
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'response-draft.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([Case(id=7, user_id=1, title='Owned case', severity='high'),
                        Case(id=9, user_id=9, title='Foreign private case', severity='critical')])
            await db.commit()
    asyncio.run(prepare())
    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    provider = SimpleNamespace(model='unit-test', complete_json=AsyncMock(return_value={
        'actions': [{'action_type': 'notify', 'target': 'soc', 'reason': 'Review the case'}],
        'rationale': 'Draft only',
    }))
    monkeypatch.setattr(response, 'get_ai_provider', lambda _: provider)
    from backend.services import action_executor
    execute = AsyncMock()
    monkeypatch.setattr(action_executor, 'execute_response_plan', execute)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, provider, sessions, execute
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old)
    asyncio.run(engine.dispose())


@pytest.mark.parametrize('fallback', [False, True])
def test_explicit_generation_saves_unapproved_l1_draft_and_ledger_without_execution(context, fallback):
    client, provider, sessions, execute = context
    if fallback:
        provider.complete_json.side_effect = RuntimeError('Unavailable')
    response = client.post('/api/v1/response-plans/draft-from-case/7',
                           json={'autonomy_level': 'L4', 'status': 'approved', 'execute': True})
    assert response.status_code == 200
    data = response.json()
    assert data['case_id'] == 7 and data['status'] == 'draft' and data['autonomy_level'] == 'L1'
    assert data['approved'] is data['execution_requested'] is False
    assert data['action_count'] == (3 if fallback else 1)
    execute.assert_not_awaited()
    async def verify():
        async with sessions() as db:
            plan = (await db.execute(select(ResponsePlan))).scalar_one()
            run = (await db.execute(select(AgentRun))).scalar_one()
            approvals = (await db.execute(select(ApprovalRequest))).scalars().all()
            assert plan.id == data['plan_id'] and plan.user_id == 1 and plan.case_id == 7
            assert plan.status == 'draft' and plan.autonomy_level == 'L1'
            assert plan.approved_by is plan.approved_at is None and approvals == []
            assert all('execution_result' not in action for action in plan.actions)
            assert run.id == data['run_id'] and run.status == 'completed'
            actions = (await db.execute(select(AgentStep.action).where(AgentStep.run_id == run.id))).scalars().all()
            assert 'planning_scope' in actions and 'create_plan' in actions
    asyncio.run(verify())
    saved = client.get(f"/api/v1/response-plans/{data['plan_id']}/approval-review")
    assert saved.status_code == 200 and saved.json()['plan']['status'] == 'draft'


@pytest.mark.parametrize('case_id', [9, 999])
def test_foreign_and_missing_cases_are_indistinguishable_and_do_not_call_ai(context, case_id):
    client, provider, _, execute = context
    assert client.post(f'/api/v1/response-plans/draft-from-case/{case_id}').status_code == 404
    provider.complete_json.assert_not_awaited()
    execute.assert_not_awaited()


@pytest.mark.parametrize('failure', ['invalid_ai', 'invalid_rationale', 'receipt_write', 'actual_constraint'])
def test_generation_failure_retains_failed_run_but_no_partial_draft_or_approval(context, monkeypatch, failure):
    client, provider, sessions, execute = context
    if failure == 'invalid_ai':
        provider.complete_json.return_value = {'actions': [{'action_type': 'notify'}]}
    elif failure == 'invalid_rationale':
        provider.complete_json.return_value['rationale'] = {'unsupported': True}
    elif failure == 'receipt_write':
        original = ResponseAgent.log_step
        async def log_step(self, action, *args, **kwargs):
            await original(self, action, *args, **kwargs)
            if action == 'create_plan':
                raise RuntimeError('Failed after staged draft and receipt')
        monkeypatch.setattr(ResponseAgent, 'log_step', log_step)
    else:
        from sqlalchemy import event
        from sqlalchemy.orm import Session
        @event.listens_for(Session, 'before_flush')
        def invalidate_plan(session, *_):
            for row in session.new:
                if isinstance(row, ResponsePlan):
                    row.case_id = None
    try:
        reply = client.post('/api/v1/response-plans/draft-from-case/7')
        assert reply.status_code == 502 and 'Check the investigation plan list' in str(reply.json())
        execute.assert_not_awaited()
        async def verify():
            async with sessions() as db:
                assert (await db.execute(select(ResponsePlan))).scalars().all() == []
                assert (await db.execute(select(ApprovalRequest))).scalars().all() == []
                run = (await db.execute(select(AgentRun))).scalar_one()
                assert run.status == 'failed' and run.completed_at is not None
                steps = (await db.execute(select(AgentStep.action))).scalars().all()
                assert 'create_plan' not in steps
        asyncio.run(verify())
    finally:
        if failure == 'actual_constraint':
            event.remove(Session, 'before_flush', invalidate_plan)


def test_bounded_prompt_records_omissions_and_text_caps_without_claiming_event_context():
    case = SimpleNamespace(title='t' * 1000, severity='high', summary='s' * 5000, mitre_tactics=['TA0001'])
    rows = [(SimpleNamespace(title=f'Alert {index}', severity='high'),
             SimpleNamespace(name=f'Asset {index}', asset_type='host', network_zone='it',
                             is_ot_asset=False, primary_protocol='tcp')) for index in range(25)]
    text = ResponseAgent(None, 1)._build_context(case, rows)
    assert 'first 20 of 25 saved links' in text and 'Alert 19' in text and 'Alert 20' not in text
    assert 't' * 501 not in text and 's' * 2001 not in text
    assert 'not supplied' in text and 'not full records or verified facts' in text
