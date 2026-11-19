"""Tests for auto-assignment of new alerts to the least-loaded org member."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.discovered_device import NetworkSensor  # noqa: F401 - mapper dependency
from backend.models.organization import Organization
from backend.models.user import User
from backend.services.assignment import auto_assignee_id
from backend.services.auth_service import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_auto_assignment.db"
_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_auto_assignment.db"
_async_engine = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
_AsyncTestingSessionLocal = async_sessionmaker(
    bind=_async_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest.fixture(scope="function", autouse=True)
def _fresh_db():
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    yield
    Base.metadata.drop_all(bind=_engine)


def _user(email: str, auto_assign: bool = True) -> User:
    return User(
        email=email,
        hashed_password=get_password_hash("testpass123"),
        full_name=f"User {email.split('@')[0]}",
        company="TestCorp",
        is_active=True,
        is_verified=True,
        auto_assign_new_alerts=auto_assign,
    )


def _org_with_members(*users: User) -> None:
    with _TestingSessionLocal() as db:
        org = Organization(name="Acme SOC", slug="acme-soc", plan="pro", max_assets=100, max_users=10)
        db.add(org)
        db.flush()
        for u in users:
            u.org_id = org.id
            db.add(u)
        db.commit()
        for u in users:
            db.refresh(u)
        # copy ids back for the caller
        for u in users:
            u._test_org_id = org.id


def _seed_alerts(owner_id: int, assignee_id: int, specs: list[str]) -> None:
    with _TestingSessionLocal() as db:
        asset = Asset(user_id=owner_id, name="edge-router", asset_type="hardware")
        db.add(asset)
        db.flush()
        for status in specs:
            db.add(Alert(
                user_id=owner_id, asset_id=asset.id, title=f"Alert {status}",
                severity="high", status=status, assigned_to_id=assignee_id,
                created_at=datetime(2026, 11, 1, tzinfo=UTC),
            ))
        db.commit()


@pytest.mark.asyncio
async def test_disabled_by_default_returns_none():
    owner = _user("owner@example.com", auto_assign=False)
    member = _user("member@example.com")
    _org_with_members(owner, member)
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) is None


@pytest.mark.asyncio
async def test_no_org_returns_none():
    owner = _user("owner@example.com")
    with _TestingSessionLocal() as db:
        db.add(owner)
        db.commit()
        db.refresh(owner)
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) is None


@pytest.mark.asyncio
async def test_solo_org_returns_none():
    owner = _user("owner@example.com")
    _org_with_members(owner)
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) is None


@pytest.mark.asyncio
async def test_no_open_alerts_picks_lowest_id():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    _org_with_members(owner, member)
    async with _AsyncTestingSessionLocal() as db:
        picked = await auto_assignee_id(db, owner)
    assert picked == min(owner.id, member.id)


@pytest.mark.asyncio
async def test_least_loaded_member_wins():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    _org_with_members(owner, member)
    # Two open alerts on the owner; none on the member.
    _seed_alerts(owner.id, owner.id, ["pending", "acknowledged"])
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) == member.id


@pytest.mark.asyncio
async def test_resolved_alerts_do_not_count():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    _org_with_members(owner, member)
    _seed_alerts(owner.id, owner.id, ["resolved", "false_positive"])
    async with _AsyncTestingSessionLocal() as db:
        # Owner's resolved alerts are ignored; tie -> lowest id.
        picked = await auto_assignee_id(db, owner)
    assert picked == min(owner.id, member.id)


def _seed_cases(owner_id: int, assignee_id: int, specs: list[str]) -> None:
    with _TestingSessionLocal() as db:
        for status in specs:
            db.add(Case(
                user_id=owner_id, title=f"Case {status}", severity="high",
                status=status, assigned_to_id=assignee_id,
            ))
        db.commit()


@pytest.mark.asyncio
async def test_open_cases_count_toward_load():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    _org_with_members(owner, member)
    # Member has fewer alerts but an open investigation; owner should win.
    _seed_alerts(owner.id, owner.id, ["pending"])
    _seed_alerts(owner.id, member.id, ["pending"])
    _seed_cases(owner.id, member.id, ["open"])
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) == owner.id


@pytest.mark.asyncio
async def test_closed_cases_do_not_count():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    _org_with_members(owner, member)
    _seed_alerts(owner.id, owner.id, ["pending"])
    _seed_alerts(owner.id, member.id, ["pending"])
    _seed_cases(owner.id, member.id, ["resolved", "closed"])
    async with _AsyncTestingSessionLocal() as db:
        # Tie on open work -> lowest id (the owner).
        picked = await auto_assignee_id(db, owner)
    assert picked == min(owner.id, member.id)


@pytest.mark.asyncio
async def test_inactive_member_excluded():
    owner = _user("owner@example.com")
    member = _user("member@example.com")
    member.is_active = False
    _org_with_members(owner, member)
    async with _AsyncTestingSessionLocal() as db:
        assert await auto_assignee_id(db, owner) is None  # only one active member
