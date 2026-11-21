"""Exact saved rule reads are owner-scoped and do not mutate configuration."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.detection_rule import DetectionRule
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'rule-evidence.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([DetectionRule(id=i, user_id=2 if i == 2 else 1,
                                     name='Duplicate rule name', description=None if i == 1 else '',
                                     rule_type='sigma', rule_content=f'title: saved rule {i}\nvalue: <script>',
                                     mitre_techniques=['T1059'], enabled=i != 1, tested=False,
                                     confidence='medium', created_by='human') for i in (1, 2, 99)])
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


@pytest.mark.parametrize('rule_id', [1, 99])
def test_exact_owner_record_is_not_selected_by_name_and_flags_remain_unchanged(client, rule_id):
    response = client.get(f'/api/v1/hunt/detections/{rule_id}')
    assert response.status_code == 200
    row = response.json()
    assert row['id'] == rule_id and row['rule_content'] == f'title: saved rule {rule_id}\nvalue: <script>'
    assert row['enabled'] is (rule_id != 1) and row['tested'] is False
    assert row['description'] == (None if rule_id == 1 else '')
    assert row['mitre_techniques'] == ['T1059']
    assert 'user_id' not in row
    assert client.get(f'/api/v1/hunt/detections/{rule_id}').json() == row


@pytest.mark.parametrize('rule_id', [2, 404, 0, -1])
def test_foreign_missing_and_invalid_records_do_not_disclose_another_owners_rule(client, rule_id):
    response = client.get(f'/api/v1/hunt/detections/{rule_id}')
    assert response.status_code == 404
    assert response.json()['error']['message'] == 'Detection rule not found'
