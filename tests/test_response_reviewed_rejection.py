"""Reviewed rejection binds the exact saved plan and preserves explicit reasons."""
# ruff: noqa: F401, F811
import asyncio

import pytest
from sqlalchemy import select
from test_response_approval_fingerprint import context, review

from backend.models.audit_log import AuditLog
from backend.models.response_plan import ApprovalRequest, ResponsePlan


def reject(client, digest, reason=''):
    return client.post('/api/v1/response-plans/7/reject-reviewed',
                       json={'reviewed_fingerprint': digest, 'reason': reason})


def test_exact_rejection_records_reason_and_fingerprint_without_execution(context):
    client, sessions = context
    digest = review(client)
    reason = '  Freeze window\nKeep quoted "target" unchanged  '
    response = reject(client, digest, reason)
    assert response.status_code == 200
    assert response.json() == {'success': True, 'message': 'Plan 7 rejected', 'plan_status': 'rejected',
                               'plan_id': 7, 'case_id': 10, 'approvals_resolved': 1}

    async def inspect():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            assert plan.status == 'rejected' and plan.approved_by is None
            assert 'execution_result' not in plan.actions[0]
            approval = await db.get(ApprovalRequest, 7)
            assert approval.status == 'rejected' and approval.reason == reason
            assert approval.reviewed_by == 1 and approval.reviewed_at
            logs = (await db.execute(select(AuditLog))).scalars().all()
            assert len(logs) == 1 and digest in logs[0].detail
    asyncio.run(inspect())
    assert reject(client, digest, reason).status_code == 400


@pytest.mark.parametrize('field,value', [('actions', [{'action_type': 'notify', 'target': 'other'}]),
    ('actions', []), ('case_id', 11), ('autonomy_level', 'L4'), ('status', 'draft')])
def test_stale_review_does_not_mutate_plan_or_approval(context, field, value):
    client, sessions = context
    digest = review(client)
    async def change():
        async with sessions() as db:
            setattr(await db.get(ResponsePlan, 7), field, value)
            await db.commit()
    asyncio.run(change())
    assert reject(client, digest, 'Changed reason').status_code == 409
    async def inspect():
        async with sessions() as db:
            approval = await db.get(ApprovalRequest, 7)
            assert approval.status == 'pending' and approval.reason is None
            assert not (await db.execute(select(AuditLog))).scalars().all()
    asyncio.run(inspect())


@pytest.mark.parametrize('reason', ['', '   ', 'x' * 2000])
def test_explicit_empty_reason_preserves_existing_while_nonempty_is_exact(context, reason):
    client, sessions = context
    async def prepare():
        async with sessions() as db:
            (await db.get(ApprovalRequest, 7)).reason = 'Original request rationale'
            db.add(ApprovalRequest(id=17, plan_id=7, status='approved', reason='Existing decision'))
            await db.commit()
    asyncio.run(prepare())
    assert reject(client, review(client), reason).status_code == 200
    async def inspect():
        async with sessions() as db:
            assert (await db.get(ApprovalRequest, 7)).reason == (reason or 'Original request rationale')
            assert (await db.get(ApprovalRequest, 17)).reason == 'Existing decision'
            assert (await db.get(ApprovalRequest, 17)).status == 'approved'
    asyncio.run(inspect())


@pytest.mark.parametrize('change', [{}, {'reviewed_fingerprint': 'bad', 'reason': ''},
    {'reviewed_fingerprint': 'f' * 64}, {'reviewed_fingerprint': 'f' * 64, 'reason': None},
    {'reviewed_fingerprint': 'f' * 64, 'reason': 2}, {'reviewed_fingerprint': 'f' * 64, 'reason': 'x' * 2001},
    {'reviewed_fingerprint': 'f' * 64, 'reason': '', 'execute': True}])
def test_rejects_missing_malformed_or_extra_fields(context, change):
    client, _ = context
    assert client.post('/api/v1/response-plans/7/reject-reviewed', json=change).status_code == 422


def test_foreign_plan_fingerprint_never_grants_owner_access(context):
    client, _ = context
    assert client.post('/api/v1/response-plans/8/reject-reviewed',
                       json={'reviewed_fingerprint': review(client), 'reason': 'No'}).status_code == 404


def test_legacy_rejection_contract_remains_available(context):
    client, _ = context
    response = client.post('/api/v1/response-plans/7/reject', json={'reason': 'Legacy decision'})
    assert response.status_code == 200 and response.json()['plan_status'] == 'rejected'
