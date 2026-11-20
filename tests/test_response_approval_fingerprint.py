"""A plan approval must match the saved evidence that the reviewer saw."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.audit_log import AuditLog
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.routers.auth import get_active_user


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'approval-review.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            for plan_id, owner in [(7, 1), (8, 2)]:
                db.add(ResponsePlan(id=plan_id, case_id=10, user_id=owner, status='pending_approval',
                                    autonomy_level='L1', actions=[{'priority': 0, 'action_type': 'notify',
                                                                 'target': 'soc', 'reason': 'Review'}]))
                db.add(ApprovalRequest(id=plan_id, plan_id=plan_id, status='pending'))
            await db.commit()
    asyncio.run(prepare())

    async def db_override():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_async_db] = db_override
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    with TestClient(app) as client:
        yield client, sessions
    app.dependency_overrides.clear()
    asyncio.run(engine.dispose())


def review(client, plan_id=7):
    response = client.get(f'/api/v1/response-plans/{plan_id}/approval-review')
    assert response.status_code == 200
    return response.json()['review_fingerprint']


def approve(client, digest, plan_id=7):
    return client.post(f'/api/v1/response-plans/{plan_id}/approve', json={'reviewed_fingerprint': digest})


def test_matching_review_approves_without_executing_and_records_fingerprint(context):
    client, sessions = context
    digest = review(client)
    assert len(digest) == 64
    assert approve(client, digest).json()['plan_status'] == 'approved'

    async def inspect():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            assert plan.status == 'approved'
            assert 'execution_result' not in plan.actions[0]
            assert (await db.get(ApprovalRequest, 7)).status == 'approved'
            logs = (await db.execute(select(AuditLog))).scalars().all()
            assert any(digest in row.detail for row in logs)
    asyncio.run(inspect())
    assert approve(client, digest).status_code == 400


@pytest.mark.parametrize('field,value', [
    ('actions', [{'action_type': 'notify', 'target': 'different-target'}]),
    ('actions', [{'action_type': 'notify', 'target': 'soc', 'priority': 1}]),
    ('actions', []), ('autonomy_level', 'L4'), ('case_id', 11), ('status', 'draft'),
])
def test_changed_review_cannot_mutate_plan_or_approval(context, field, value):
    client, sessions = context
    digest = review(client)

    async def mutate():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            setattr(plan, field, value)
            await db.commit()
    asyncio.run(mutate())
    response = approve(client, digest)
    assert response.status_code == 409

    async def inspect():
        async with sessions() as db:
            assert (await db.get(ResponsePlan, 7)).approved_by is None
            assert (await db.get(ApprovalRequest, 7)).status == 'pending'
            assert not (await db.execute(select(AuditLog))).scalars().all()
    asyncio.run(inspect())


@pytest.mark.parametrize('payload', [{}, {'reviewed_fingerprint': 'wrong'}, {'reviewed_fingerprint': 'g' * 64}])
def test_missing_or_malformed_review_is_rejected(context, payload):
    client, _ = context
    assert client.post('/api/v1/response-plans/7/approve', json=payload).status_code == 422


def test_fingerprint_does_not_grant_access_to_another_owners_plan(context):
    client, _ = context
    digest = review(client)
    assert client.get('/api/v1/response-plans/8/approval-review').status_code == 404
    assert approve(client, digest, 8).status_code == 404
    pending = client.get('/api/v1/response-plans/pending-approvals').json()['data']
    assert [row['plan_id'] for row in pending] == [7]
    assert pending[0]['review_fingerprint'] == digest


def test_fresh_review_after_change_allows_an_explicit_new_approval(context):
    client, sessions = context
    old = review(client)

    async def mutate():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            plan.actions = [{'action_type': 'notify', 'target': 'new-review-target'}]
            await db.commit()
    asyncio.run(mutate())
    assert approve(client, old).status_code == 409
    fresh = review(client)
    assert fresh != old
    assert approve(client, fresh).status_code == 200


def test_dictionary_key_order_does_not_invalidate_a_review(context):
    client, sessions = context
    digest = review(client)

    async def reorder():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            plan.actions = [{'reason': 'Review', 'target': 'soc', 'action_type': 'notify', 'priority': 0}]
            await db.commit()
    asyncio.run(reorder())
    assert review(client) == digest
    assert approve(client, digest).status_code == 200


def test_empty_plan_is_not_approvable_even_with_matching_fingerprint(context):
    client, sessions = context

    async def clear_actions():
        async with sessions() as db:
            plan = await db.get(ResponsePlan, 7)
            plan.actions = []
            await db.commit()
    asyncio.run(clear_actions())
    assert approve(client, review(client)).status_code == 400


def test_pending_inbox_has_bounded_stable_pages_and_owner_scoped_total(context):
    from datetime import UTC, datetime

    client, sessions = context

    async def populate():
        async with sessions() as db:
            original = await db.get(ApprovalRequest, 7)
            original.created_at = datetime(2026, 11, 20, 12, tzinfo=UTC)
            for request_id in range(100, 120):
                db.add(ApprovalRequest(id=request_id, plan_id=7, status='pending',
                                       created_at=datetime(2026, 11, 20, 12, tzinfo=UTC)))
            db.add(ApprovalRequest(id=200, plan_id=7, status='approved'))
            await db.commit()
    asyncio.run(populate())
    pages = [client.get('/api/v1/response-plans/pending-approvals', params={'page': page, 'size': 10}).json()
             for page in (1, 2, 3)]
    assert [row['total'] for row in pages] == [21, 21, 21]
    assert [len(row['data']) for row in pages] == [10, 10, 1]
    ids = [item['id'] for page in pages for item in page['data']]
    assert ids == [*range(119, 99, -1), 7]
    assert all(item['review_fingerprint'] for page in pages for item in page['data'])
    assert [row['page'] for row in pages] == [1, 2, 3]
    assert len(client.get('/api/v1/response-plans/pending-approvals').json()['data']) == 10


@pytest.mark.parametrize('params', [{'page': 0}, {'size': 0}, {'size': 101}, {'page': 'wrong'}])
def test_pending_page_bounds_are_validated(context, params):
    client, _ = context
    assert client.get('/api/v1/response-plans/pending-approvals', params=params).status_code == 422
