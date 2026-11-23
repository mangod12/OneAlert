"""Exact plan removal includes every approval row in its reviewed fingerprint."""
# ruff: noqa: F401, F811
import asyncio

import pytest
from sqlalchemy import select
from test_response_approval_fingerprint import context

from backend.models.audit_log import AuditLog
from backend.models.response_plan import ApprovalRequest, ResponsePlan


def make_deletable(sessions, status='draft'):
    async def prepare():
        async with sessions() as db:
            (await db.get(ResponsePlan, 7)).status = status
            await db.commit()
    asyncio.run(prepare())


def review(client):
    response = client.get('/api/v1/response-plans/7/deletion-review')
    assert response.status_code == 200
    return response.json()


def remove(client, digest):
    return client.post('/api/v1/response-plans/7/delete-reviewed', json={'reviewed_fingerprint': digest})


@pytest.mark.parametrize('status', ['draft', 'rejected'])
def test_reviewed_removal_deletes_exact_plan_and_history_but_keeps_audit(context, status):
    client, sessions = context
    make_deletable(sessions, status)
    evidence = review(client)
    assert evidence['approval_count'] == 1 and evidence['approval_status_counts'] == {'pending': 1}
    response = remove(client, evidence['deletion_fingerprint'])
    assert response.status_code == 200
    assert response.json() == {'success': True, 'deleted': True, 'plan_id': 7, 'case_id': 10, 'approvals_deleted': 1}
    async def inspect():
        async with sessions() as db:
            assert await db.get(ResponsePlan, 7) is None
            assert await db.get(ApprovalRequest, 7) is None
            assert await db.get(ResponsePlan, 8) is not None
            assert await db.get(ApprovalRequest, 8) is not None
            logs = (await db.execute(select(AuditLog))).scalars().all()
            assert len(logs) == 1 and logs[0].action == 'response_plan_deleted'
            assert evidence['deletion_fingerprint'] in logs[0].detail
    asyncio.run(inspect())
    assert remove(client, evidence['deletion_fingerprint']).status_code == 404


@pytest.mark.parametrize('field,value', [('actions', []), ('case_id', 11), ('autonomy_level', 'L4'),
                                       ('approved_by', 55), ('created_by', 'Different source')])
def test_changed_plan_rejects_removal_without_erasing_history(context, field, value):
    client, sessions = context
    make_deletable(sessions)
    digest = review(client)['deletion_fingerprint']
    async def change():
        async with sessions() as db:
            setattr(await db.get(ResponsePlan, 7), field, value)
            await db.commit()
    asyncio.run(change())
    assert remove(client, digest).status_code == 409
    async def inspect():
        async with sessions() as db:
            assert await db.get(ResponsePlan, 7) is not None
            assert await db.get(ApprovalRequest, 7) is not None
            assert not (await db.execute(select(AuditLog))).scalars().all()
    asyncio.run(inspect())


@pytest.mark.parametrize('change', ['reason', 'reviewer', 'status', 'insert', 'remove'])
def test_any_approval_history_change_invalidates_deletion(context, change):
    client, sessions = context
    make_deletable(sessions)
    digest = review(client)['deletion_fingerprint']
    async def mutate():
        async with sessions() as db:
            row = await db.get(ApprovalRequest, 7)
            if change == 'reason':
                row.reason = 'New evidence to retain'
            elif change == 'reviewer':
                row.reviewed_by = 55
            elif change == 'status':
                row.status = 'approved'
            elif change == 'insert':
                db.add(ApprovalRequest(id=17, plan_id=7, status='rejected', reason='Later decision'))
            else:
                await db.delete(row)
            await db.commit()
    asyncio.run(mutate())
    assert remove(client, digest).status_code == 409


@pytest.mark.parametrize('status', ['pending_approval', 'approved', 'executing', 'completed'])
def test_non_deletable_states_fail_even_with_matching_fingerprint(context, status):
    client, sessions = context
    make_deletable(sessions, status)
    assert remove(client, review(client)['deletion_fingerprint']).status_code == 400


@pytest.mark.parametrize('body', [{}, {'reviewed_fingerprint': 'bad'},
    {'reviewed_fingerprint': 'f' * 64, 'delete_all': True}, {'reviewed_fingerprint': 7}])
def test_strict_reviewed_payload(context, body):
    client, _ = context
    assert client.post('/api/v1/response-plans/7/delete-reviewed', json=body).status_code == 422


def test_foreign_plan_and_missing_review_are_not_accessible(context):
    client, _ = context
    assert client.get('/api/v1/response-plans/8/deletion-review').status_code == 404
    assert client.post('/api/v1/response-plans/8/delete-reviewed',
                       json={'reviewed_fingerprint': 'f' * 64}).status_code == 404
