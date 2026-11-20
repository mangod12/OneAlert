"""Complete owned evidence selection excludes linked and foreign records."""
import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_active_user


@pytest.fixture
def context(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'candidates.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add(Case(id=7, user_id=1, assigned_to_id=2, title="Investigation", severity="low", status="open"))
            for i in range(125):
                when = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=i)
                db.add(Alert(id=100+i, user_id=1 if i < 124 else 2, asset_id=1,
                             title="Old 100%_literal alert" if i == 0 else f"Alert {i}",
                             cve_id="CVE-2099-0100" if i == 0 else None,
                             severity="critical" if i == 0 else "high", status="resolved", created_at=when))
                db.add(SecurityEvent(id=100+i, user_id=1 if i < 124 else 2,
                                     event_type="dns", signature="Old 100%_literal event" if i == 0 else f"Event {i}",
                                     severity="critical" if i == 0 else "high", timestamp=when,
                                     source_ip="10.0.0.1", dest_ip="8.8.8.8", processed="in_case"))
            db.add_all([CaseAlert(case_id=7, alert_id=101), CaseEvent(case_id=7, event_id=101)])
            await db.commit()
    asyncio.run(prepare())
    async def db_override():
        async with sessions() as db:
            yield db
    principal = {"id": 1}
    app.dependency_overrides[get_async_db] = db_override
    app.dependency_overrides[get_active_user] = lambda: SimpleNamespace(**principal)
    with TestClient(app) as client:
        yield client, principal
    app.dependency_overrides.clear()
    asyncio.run(engine.dispose())


@pytest.mark.parametrize("kind", ["alert", "event"])
def test_complete_paginated_owned_unlinked_scope_and_literal_search(context, kind):
    client, _ = context
    url = "/api/v1/cases/7/evidence-candidates"
    response = client.get(url, params={"kind": kind})
    assert response.status_code == 200
    assert response.json()["total"] == 123 and len(response.json()["data"]) == 10
    rows = [row for page in (1, 2) for row in
            client.get(url, params={"kind": kind, "size": 100, "page": page}).json()["data"]]
    assert len({row["id"] for row in rows}) == 123
    assert 101 not in {row["id"] for row in rows} and 224 not in {row["id"] for row in rows}
    assert rows[-1]["id"] == 100 and rows[0]["id"] == 223
    old = client.get(url, params={"kind": kind, "query": "  100%_LITERAL  ", "severity": "critical"}).json()
    assert old["total"] == 1 and old["data"][0]["id"] == 100
    assert client.get(url, params={"kind": kind, "query": "%notpresent_"}).json()["total"] == 0
    assert client.get(url, params={"kind": kind, "query": "' OR 1=1 --"}).json()["total"] == 0
    assert client.get(url, params={"kind": kind, "page": 500}).json()["data"] == []


def test_expected_search_fields_owner_only_case_scope_and_missing_case(context):
    client, principal = context
    url = "/api/v1/cases/7/evidence-candidates"
    assert client.get(url, params={"kind": "alert", "query": "CVE-2099-0100"}).json()["total"] == 1
    assert client.get(url, params={"kind": "event", "query": "10.0.0.1"}).json()["total"] == 123
    principal["id"] = 2  # Assignment alone never permits choosing/linking the owner's evidence.
    assert client.get(url, params={"kind": "alert"}).status_code == 404
    principal["id"] = 3
    assert client.get(url, params={"kind": "event"}).status_code == 404
    principal["id"] = 1
    assert client.get('/api/v1/cases/999/evidence-candidates', params={"kind": "alert"}).status_code == 404


@pytest.mark.parametrize("params", [{}, {"kind": "user"}, {"kind": "alert", "size": 101},
                                     {"kind": "event", "query": "x" * 201}, {"kind": "alert", "page": 0},
                                     {"kind": "event", "severity": "unknown"}])
def test_input_validation(context, params):
    client, _ = context
    assert client.get('/api/v1/cases/7/evidence-candidates', params=params).status_code == 422
