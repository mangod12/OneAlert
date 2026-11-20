"""Read response decision records without approving or executing them."""
import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.response_plan import ApprovalRequest, ResponsePlan
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'decision-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([
                ResponsePlan(id=7, case_id=10, user_id=1, status='partial', autonomy_level='L1',
                             created_by='agent', approved_by=1,
                             actions=[{'priority': 0, 'action_type': 'isolate', 'target': '192.0.2.7',
                                       'reason': 'Recorded reason', 'policy_check': {'approved': False},
                                       'execution_result': {'status': 'failed', 'detail': 'Recorded failure',
                                                            'executed_at': '2026-11-20T18:00:00+05:30'}},
                                      {'action_type': 'notify', 'target': 'local', 'reason': 'No result yet'}]),
                ResponsePlan(id=8, case_id=11, user_id=2, status='approved', actions=[]),
                ResponsePlan(id=9, case_id=10, user_id=1, status='draft', actions=[]),
            ])
            for i in range(1, 13):
                db.add(ApprovalRequest(id=i, plan_id=7, requested_by='agent',
                                       status='rejected' if i == 12 else 'pending',
                                       reason='Review window unavailable' if i == 12 else None,
                                       reviewed_by=1 if i == 12 else None,
                                       reviewed_at=datetime(2026, 11, 20, 18, tzinfo=UTC) if i == 12 else None,
                                       created_at=datetime(2026, 11, 20, 17, tzinfo=UTC)))
            db.add(ApprovalRequest(id=99, plan_id=8, requested_by='private', reason='Foreign reason'))
            await db.commit()
    asyncio.run(prepare())

    async def database():
        async with sessions() as db:
            yield db
    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        asyncio.run(engine.dispose())


def read(client, plan=7, **params):
    response = client.get(f'/api/v1/response-plans/{plan}/decision-evidence', params=params)
    assert response.status_code == 200
    return response.json()


def test_current_plan_and_mutable_approval_records_are_honest_and_scoped(client):
    snapshot = read(client)
    assert snapshot['plan']['id'] == 7 and snapshot['plan']['status'] == 'partial'
    assert snapshot['approval_total'] == 12 and snapshot['approval_page'] == 1
    assert [row['id'] for row in snapshot['approval_records']] == list(range(12, 2, -1))
    assert snapshot['approval_records'][0]['reason'] == 'Review window unavailable'
    assert snapshot['approval_records'][0]['reviewed_by'] == 1
    assert snapshot['approval_records'][1]['reviewed_by'] is None
    action = snapshot['plan']['actions'][0]
    assert action['priority'] == 0 and action['policy_check']['approved'] is False
    assert action['execution_result']['executed_at'] == '2026-11-20T18:00:00+05:30'
    assert 'execution_result' not in snapshot['plan']['actions'][1]
    assert 'mutable' in snapshot['scope'] and 'not an immutable decision log' in snapshot['scope']
    assert 'Foreign reason' not in str(snapshot) and 'user_id' not in snapshot['plan']
    assert snapshot['retrieved_at']


def test_stable_paging_and_empty_records_do_not_invent_an_approval(client):
    second = read(client, page=2)
    assert [row['id'] for row in second['approval_records']] == [2, 1]
    assert second['approval_total'] == 12 and second['plan']['id'] == 7
    assert read(client, page=3)['approval_records'] == []
    empty = read(client, plan=9)
    assert empty['approval_total'] == 0 and empty['approval_records'] == []
    assert empty['plan']['approved_by'] is None and empty['plan']['actions'] == []
    # Repeated evidence reads do not alter decisions or execution state.
    assert read(client)['plan'] == second['plan']


@pytest.mark.parametrize('plan', [8, 999])
def test_foreign_and_missing_plan_are_indistinguishable(client, plan):
    response = client.get(f'/api/v1/response-plans/{plan}/decision-evidence')
    assert response.status_code == 404 and response.json()['error']['message'] == 'Response plan not found'


@pytest.mark.parametrize('params', [{'page': 0}, {'page': 1000001}, {'size': 0}, {'size': 101}])
def test_pagination_is_bounded(client, params):
    assert client.get('/api/v1/response-plans/7/decision-evidence', params=params).status_code == 422
