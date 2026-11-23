"""Exact saved-plan and handler review before local simulation."""
# ruff: noqa: F401, F811
import asyncio

import pytest
from sqlalchemy import select
from test_response_approval_fingerprint import context

from backend.models.audit_log import AuditLog
from backend.models.response_plan import ResponsePlan


def prepare(context, actions=None):
    client, sessions = context
    async def change():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            plan.status = 'approved'
            plan.approved_by = 1
            if actions is not None:
                plan.actions = actions
            await db.commit()
    asyncio.run(change())
    response = client.get('/api/v1/response-plans/7/simulation-review')
    assert response.status_code == 200
    return response.json()


def simulate(client, evidence):
    return client.post('/api/v1/response-plans/7/simulate-reviewed',
                       json={'reviewed_fingerprint': evidence['reviewed_fingerprint']})


def test_review_is_readonly_and_exact_run_records_simulation(context):
    client, sessions = context
    evidence = prepare(context, [{'action_type': 'custom', 'target': 'legacy', 'priority': 2},
                                 {'action_type': 'notify', 'target': 'soc', 'priority': 0}])
    assert evidence['execution_mode'] == 'simulated'
    assert evidence['preflight']['unsupported_count'] == 1
    assert evidence['preflight']['records'][1]['simulation_order'] == 1
    async def inspect_before():
        async with sessions() as db:
            assert (await db.get(ResponsePlan, 7)).status == 'approved'
            assert not (await db.execute(select(AuditLog))).scalars().all()
    asyncio.run(inspect_before())
    response = simulate(client, evidence)
    assert response.status_code == 200
    result = response.json()['data']
    assert result['execution_mode'] == 'simulated' and result['status'] == 'partial'
    assert result['succeeded'] == result['failed'] == 1
    assert [row['target'] for row in result['results']] == ['soc', 'legacy']
    assert result['results'][1]['status'] == 'skipped'
    async def inspect_after():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            assert plan.status == 'partial'
            assert plan.actions[0]['execution_result']['execution_mode'] == 'simulated'
            logs = (await db.execute(select(AuditLog))).scalars().all()
            assert len(logs) == 1 and evidence['reviewed_fingerprint'] in logs[0].detail
    asyncio.run(inspect_after())
    assert simulate(client, evidence).status_code == 400


@pytest.mark.parametrize('field,value', [('actions', [{'action_type': 'notify', 'target': 'changed'}]),
    ('case_id', 11), ('autonomy_level', 'L4'), ('approved_by', 9)])
def test_stale_plan_or_approval_metadata_never_runs(context, field, value):
    client, sessions = context
    evidence = prepare(context)
    async def change():
        async with sessions() as db:
            setattr(await db.get(ResponsePlan, 7), field, value)
            await db.commit()
    asyncio.run(change())
    assert simulate(client, evidence).status_code == 409
    async def inspect():
        async with sessions() as db:
            assert (await db.get(ResponsePlan, 7)).status == 'approved'
            assert not (await db.execute(select(AuditLog))).scalars().all()
    asyncio.run(inspect())


def test_changed_handler_registry_requires_fresh_review(context, monkeypatch):
    from backend.services.action_executor import ACTION_HANDLERS
    evidence = prepare(context)
    monkeypatch.setitem(ACTION_HANDLERS, 'new_handler', '_execute_notify')
    assert simulate(context[0], evidence).status_code == 409


@pytest.mark.parametrize('actions', [[], [None], [{'action_type': 'notify', 'target': 'soc', 'priority': 'bad'}],
                                    [{'action_type': 'notify', 'target': ''}]])
def test_unusable_or_empty_action_list_does_not_run(context, actions):
    evidence = prepare(context, actions)
    assert simulate(context[0], evidence).status_code == 422


@pytest.mark.parametrize('status', ['draft', 'pending_approval', 'rejected', 'executing', 'partial', 'completed'])
def test_nonapproved_plan_cannot_run(context, status):
    client, sessions = context
    evidence = prepare(context)
    async def change():
        async with sessions() as db:
            (await db.get(ResponsePlan, 7)).status = status
            await db.commit()
    asyncio.run(change())
    assert simulate(client, evidence).status_code == 400


@pytest.mark.parametrize('body', [{}, {'reviewed_fingerprint': 'bad'}, {'reviewed_fingerprint': 3},
                                  {'reviewed_fingerprint': 'f' * 64, 'execute': True}])
def test_strict_request_shape(context, body):
    assert context[0].post('/api/v1/response-plans/7/simulate-reviewed', json=body).status_code == 422


def test_owner_checks_and_legacy_compatibility(context):
    client, _ = context
    evidence = prepare(context)
    assert client.get('/api/v1/response-plans/8/simulation-review').status_code == 404
    assert client.post('/api/v1/response-plans/8/simulate-reviewed',
                       json={'reviewed_fingerprint': evidence['reviewed_fingerprint']}).status_code == 404
    response = client.post('/api/v1/response-plans/7/execute')
    assert response.status_code == 200 and response.json()['data']['status'] == 'completed'
