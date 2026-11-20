"""Recorded source filtering stays aligned across list, export and saved views."""
import asyncio
import csv
import io
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.dependencies.user_dependencies import get_current_user
from backend.main import app
from backend.models.security_event import EventSource, SecurityEvent
from backend.routers.auth import get_active_user


@pytest.fixture
def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'source-filter.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def seed():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([
                EventSource(id=1, user_id=1, name="plant-a", source_type="suricata"),
                EventSource(id=2, user_id=1, name="plant-b", source_type="suricata"),
                EventSource(id=3, user_id=2, name="private", source_type="suricata"),
            ])
            for identity, owner, source, severity in [(1, 1, 1, "high"), (2, 1, 1, "low"),
                                                       (3, 1, 2, "high"), (4, 2, 3, "high")]:
                db.add(SecurityEvent(id=identity, user_id=owner, source_id=source, timestamp=datetime.now(UTC),
                                     event_type="alert", severity=severity, source_type="suricata"))
            await db.commit()
    asyncio.run(seed())

    async def database():
        async with sessions() as db:
            yield db
    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_async_db] = database
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)
        asyncio.run(engine.dispose())


def test_recorded_source_filter_and_count_are_not_just_parser_type(client):
    response = client.get('/api/v1/events/', params={"source_id": 1, "size": 1})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert len(response.json()["events"]) == 1
    assert response.json()["events"][0]["source_id"] == 1
    response = client.get('/api/v1/events/', params={"source_id": 1, "severity": "high"})
    assert response.json()["total"] == 1 and response.json()["events"][0]["id"] == 1


@pytest.mark.parametrize('source', [3, 999])
def test_other_owner_or_missing_source_does_not_disclose_rows(client, source):
    response = client.get('/api/v1/events/', params={"source_id": source})
    assert response.status_code == 200 and response.json()["total"] == 0
    export = client.get('/api/v1/events/export', params={"source_id": source})
    assert len(list(csv.reader(io.StringIO(export.text)))) == 1


def test_filtered_export_and_saved_view_preserve_source(client):
    export = client.get('/api/v1/events/export', params={"source_id": 1, "severity": "high"})
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert [row["id"] for row in rows] == ["1"]
    view = client.post('/api/v1/events/views/', json={"name": "Plant A", "filters": {"source_id": 1}})
    assert view.status_code == 201 and view.json()["filters"] == {"source_id": 1}
    assert client.get('/api/v1/events/views/').json()[0]["filters"] == {"source_id": 1}


@pytest.mark.parametrize('source', [0, -1, 'bad'])
def test_invalid_source_filters_are_rejected(client, source):
    assert client.get('/api/v1/events/', params={"source_id": source}).status_code == 422
    assert client.get('/api/v1/events/export', params={"source_id": source}).status_code == 422
    response = client.post('/api/v1/events/views/', json={"name": "Invalid", "filters": {"source_id": source}})
    assert response.status_code == 422
