"""Tests for the incident-formed notification in alert creation."""

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database.db import Base
from backend.models import (  # noqa: F401 - register all FK targets for create_all
    alert as _m_alert,
)
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.notification import Notification
from backend.models.user import User
from backend.services.alert_checker import _notify_incident_formed

_async_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}
)
_Session = async_sessionmaker(bind=_async_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def session():
    async with _async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with _Session() as db:
        yield db
    async with _async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _user() -> User:
    return User(email="inc@example.com", hashed_password="x", full_name="Analyst", is_active=True)


def _alert(user_id: int, asset_id: int, title: str, status: str = "pending") -> Alert:
    return Alert(user_id=user_id, asset_id=asset_id, title=title, severity="high", status=status)


@pytest.mark.asyncio
async def test_notifies_on_second_active_alert(session):
    user = _user()
    session.add(user)
    await session.flush()
    asset = Asset(user_id=user.id, name="plc-01", asset_type="hardware")
    session.add(asset)
    await session.flush()

    session.add(_alert(user.id, asset.id, "first"))
    await session.flush()
    await _notify_incident_formed(session, user, asset)
    assert (await session.execute(select(Notification))).scalars().all() == []

    session.add(_alert(user.id, asset.id, "second"))
    await session.flush()
    await _notify_incident_formed(session, user, asset)
    rows = (await session.execute(select(Notification))).scalars().all()
    assert len(rows) == 1
    assert rows[0].kind == "incident_formed"
    assert rows[0].link == "/app/incidents"
    assert "plc-01" in rows[0].title

    session.add(_alert(user.id, asset.id, "third"))
    await session.flush()
    await _notify_incident_formed(session, user, asset)
    assert len((await session.execute(select(Notification))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_resolved_alerts_do_not_count(session):
    user = _user()
    session.add(user)
    await session.flush()
    asset = Asset(user_id=user.id, name="plc-02", asset_type="hardware")
    session.add(asset)
    await session.flush()

    session.add(_alert(user.id, asset.id, "old", status="resolved"))
    session.add(_alert(user.id, asset.id, "new"))
    await session.flush()
    await _notify_incident_formed(session, user, asset)
    assert (await session.execute(select(Notification))).scalars().all() == []
