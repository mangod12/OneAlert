"""Shared discovery triage filters, stable ordering and scoped capped export."""

import asyncio
import csv
import io
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database.db import Base, get_async_db
from backend.main import app
from backend.models.discovered_device import DiscoveredDevice
from backend.routers.auth import get_active_user
from backend.routers.ot import export_discovered_devices, list_discovered_devices

OWNER = SimpleNamespace(id=1)


async def seed(db):
    for identity in range(1, 26):
        db.add(
            DiscoveredDevice(
                id=identity,
                user_id=1,
                ip_address=f"10.0.0.{identity:02}",
                hostname="PLC 100%_zone" if identity == 1 else "PLC",
                discovery_method="sensor_report",
                manufacturer="Example controls",
                model="MX-100",
                serial_number="SER-42",
                firmware_version="4.2",
                risk_score=75,
                confidence="high",
                is_ot_device=True,
                is_correlated=False,
                sensor_id=10,
                last_seen=datetime(2026, 1, 1, tzinfo=UTC),
                protocols=["modbus", "tcp"],
            )
        )
    db.add_all(
        [
            DiscoveredDevice(
                id=26,
                user_id=2,
                ip_address="10.0.0.26",
                hostname="Private PLC",
                discovery_method="sensor_report",
                manufacturer="Example controls",
                confidence="high",
                sensor_id=10,
                risk_score=99,
                is_ot_device=True,
            ),
            DiscoveredDevice(
                id=27,
                user_id=1,
                ip_address="192.0.2.1",
                hostname="=formula",
                discovery_method="manual_import",
                confidence="low",
                risk_score=0,
                is_ot_device=False,
                is_correlated=True,
                correlation_score=0,
                notes="\t+formula",
                last_seen=datetime(2025, 1, 1, tzinfo=UTC),
            ),
        ]
    )
    await db.commit()


async def scenario(path, operation):
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            await seed(db)
            await operation(db)
    finally:
        await engine.dispose()


def options(db, **kwargs):
    return dict(
        page=1,
        size=20,
        ip_address=None,
        ot_only=False,
        risk_min=None,
        risk_max=None,
        correlated=None,
        current_user=OWNER,
        db=db,
        **kwargs,
    )


def test_combined_filters_cover_all_owned_rows_and_stable_pages(tmp_path):
    async def check(db):
        params = options(db, search="Example controls", sensor_id=10, confidence="high", sort="risk")
        params.update(ot_only=True, correlated=False, risk_min=70, risk_max=80)
        first = await list_discovered_devices(**params)
        params["page"] = 2
        second = await list_discovered_devices(**params)
        assert first.total == second.total == 25
        assert [device.id for device in first.devices] == list(range(25, 5, -1))
        assert [device.id for device in second.devices] == [5, 4, 3, 2, 1]
        assert all(device.user_id == 1 for device in first.devices + second.devices)
        exported = await export_discovered_devices(
            search="Example controls",
            sensor_id=10,
            confidence="high",
            ot_only=True,
            correlated=False,
            risk_min=70,
            risk_max=80,
            current_user=OWNER,
            db=db,
        )
        rows = list(csv.DictReader(io.StringIO(exported.body.decode("utf-8-sig"))))
        assert len(rows) == 25
        assert [int(row["id"]) for row in rows] == list(range(25, 0, -1))
        assert "Private PLC" not in exported.body.decode()
        assert rows[0]["matching_total"] == "25" and rows[0]["truncated"] == "False"
        scope = json.loads(rows[0]["scope_filters"])
        assert scope["risk_min"] == 70 and scope["correlated"] is False
        assert scope["sensor_id"] == 10 and scope["confidence"] == "high"
        assert "not a live scan" in rows[0]["evidence_scope"]

    asyncio.run(scenario(tmp_path / "combined.db", check))


@pytest.mark.parametrize("search", ["SER-42", "MX-100", "4.2", "Example controls"])
def test_search_includes_recorded_serial_model_firmware_and_manufacturer(tmp_path, search):
    async def check(db):
        result = await list_discovered_devices(**options(db, search=search))
        assert result.total == 25

    asyncio.run(scenario(tmp_path / "search.db", check))


def test_literal_search_zero_risk_and_source_less_filters(tmp_path):
    async def check(db):
        result = await list_discovered_devices(**options(db, search="100%_zone"))
        assert result.total == 1 and result.devices[0].id == 1
        params = options(db)
        params.update(ip_address="%", risk_min=0, risk_max=100)
        assert (await list_discovered_devices(**params)).total == 0
        params = options(db, sensor_id=0, confidence="low")
        params.update(risk_min=0, risk_max=0, correlated=True)
        result = await list_discovered_devices(**params)
        assert result.total == 1 and result.devices[0].id == 27
        exported = await export_discovered_devices(
            sensor_id=0, risk_min=0, risk_max=0, correlated=True, current_user=OWNER, db=db
        )
        row = next(csv.DictReader(io.StringIO(exported.body.decode("utf-8-sig"))))
        assert row["hostname"] == "'=formula"
        assert row["notes"] == "'\t+formula"
        assert row["risk_score"] == "0.0" and row["correlation_score"] == "0.0"
        assert row["sensor_id"] == ""

    asyncio.run(scenario(tmp_path / "literal.db", check))


def test_ordering_and_export_limit_are_explicit_and_owner_scoped(tmp_path, monkeypatch):
    import backend.routers.ot as router
    import backend.services.ot_discovery_query as service

    assert service.EXPORT_LIMIT == 5000
    monkeypatch.setattr(router, "EXPORT_LIMIT", 2)
    monkeypatch.setattr(service, "EXPORT_LIMIT", 2)

    async def check(db):
        oldest = await list_discovered_devices(**options(db, sort="oldest"))
        assert oldest.devices[0].id == 27
        ip = await list_discovered_devices(**options(db, sort="ip"))
        assert [row.id for row in ip.devices][:3] == [1, 2, 3]
        exported = await export_discovered_devices(sort="ip", current_user=OWNER, db=db)
        rows = list(csv.DictReader(io.StringIO(exported.body.decode("utf-8-sig"))))
        assert [row["id"] for row in rows] == ["1", "2"]
        assert all(
            row["matching_total"] == "26" and row["exported_count"] == "2" and row["truncated"] == "True"
            for row in rows
        )
        assert exported.headers["x-export-truncated"] == "true"
        assert exported.headers["x-matching-total"] == "26"

    asyncio.run(scenario(tmp_path / "limit.db", check))


def test_empty_export_has_header_and_zero_scope_counts(tmp_path):
    async def check(db):
        exported = await export_discovered_devices(search="not present", current_user=OWNER, db=db)
        assert list(csv.DictReader(io.StringIO(exported.body.decode("utf-8-sig")))) == []
        assert exported.headers["x-matching-total"] == "0"
        assert exported.headers["x-exported-count"] == "0"
        assert exported.headers["x-export-truncated"] == "false"
        assert "scope_filters" in exported.body.decode()

    asyncio.run(scenario(tmp_path / "empty.db", check))


@pytest.mark.parametrize("path", ["/api/v1/ot/discovered-devices", "/api/v1/ot/discovered-devices/export"])
@pytest.mark.parametrize(
    "params,status",
    [
        ({"risk_min": 90, "risk_max": 10}, 400),
        ({"risk_min": -1}, 422),
        ({"risk_max": 101}, 422),
        ({"sort": "unsafe"}, 422),
        ({"sensor_id": -1}, 422),
        ({"confidence": "guessed"}, 422),
        ({"search": "x" * 201}, 422),
        ({"ip_address": "x" * 201}, 422),
    ],
)
def test_invalid_filters_reject_before_any_database_read(path, params, status):
    db = Mock(execute=AsyncMock())
    previous = dict(app.dependency_overrides)

    async def override_db():
        yield db

    app.dependency_overrides[get_async_db] = override_db
    app.dependency_overrides[get_active_user] = lambda: OWNER
    try:
        client = TestClient(app)
        response = client.get(path, params=params)
        assert response.status_code == status
        db.execute.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
