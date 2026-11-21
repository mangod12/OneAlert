"""
Tests for the SLA compliance report endpoint.

Covers: met/breached scoring for alerts and investigations due inside the
window, severity buckets, upcoming (not yet due) counts, attainment
percentage, window validation, and owner isolation.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from backend.database.db import Base, get_async_db, get_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.case import Case
from backend.models.user import User
from backend.services.auth_service import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reports_sla.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_reports_sla.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session


# These fixtures and the report must share a clock even if the suite crosses UTC midnight.
NOW = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
TODAY = NOW.date()


@pytest.fixture(autouse=True)
def fixed_report_clock(monkeypatch):
    class DateTimeType(type):
        def __instancecheck__(cls, instance):
            return isinstance(instance, datetime)

    class FrozenDateTime(datetime, metaclass=DateTimeType):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz is not None else NOW.replace(tzinfo=None)
    monkeypatch.setattr('backend.routers.reports.datetime', FrozenDateTime)



def _naive(days_ago=0):
    return (NOW - timedelta(days=days_ago)).replace(tzinfo=None)


def _seed(session, user_id):
    router = Asset(
        user_id=user_id, name="edge-router", asset_type="hardware",
        vendor="NetCo", product="EdgeOS",
    )
    session.add(router)
    session.flush()

    # Met: due yesterday, resolved two days ago.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Patched on time",
        description="met", severity="critical", status="resolved",
        created_at=_naive(days_ago=4),
                    due_date=TODAY - timedelta(days=1),
        resolved_at=_naive(days_ago=2),
    ))
    # Breached: due five days ago, still open.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Overdue triage",
        description="breached", severity="high", status="pending",
        created_at=_naive(days_ago=6),
                    due_date=TODAY - timedelta(days=5),
    ))
    # Breached: due three days ago, resolved only yesterday.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Late patch",
        description="breached", severity="high", status="resolved",
        created_at=_naive(days_ago=6),
                    due_date=TODAY - timedelta(days=3),
        resolved_at=_naive(days_ago=1),
    ))
    # Upcoming: due in three days, not scored.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Future triage",
        description="upcoming", severity="low", status="acknowledged",
        created_at=_naive(days_ago=1),
                    due_date=TODAY + timedelta(days=3),
    ))
    # Outside the window: due 60 days ago.
    session.add(Alert(
        user_id=user_id, asset_id=router.id, title="Ancient alert",
        description="out of window", severity="medium", status="resolved",
        created_at=_naive(days_ago=65),
                    due_date=TODAY - timedelta(days=60),
        resolved_at=_naive(days_ago=61),
    ))

    # Met case: recorded close-out occurred before its due date.
    session.add(Case(
        user_id=user_id, title="Closed in time", severity="high", status="closed",
        created_at=_naive(days_ago=4), closed_at=_naive(days_ago=2), updated_at=_naive(),
        due_date=TODAY - timedelta(days=1),
    ))
    # Breached case: still open past its due date.
    session.add(Case(
        user_id=user_id, title="Overdue investigation", severity="medium",
        status="investigating", created_at=_naive(days_ago=8),
        due_date=TODAY - timedelta(days=2),
    ))
    # Upcoming case: due in five days.
    session.add(Case(
        user_id=user_id, title="Upcoming investigation", severity="low",
        status="open", created_at=_naive(days_ago=1),
        due_date=TODAY + timedelta(days=5),
    ))
    session.commit()


@pytest.fixture(scope="function")
def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        user = User(
            email="sla_report_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="SLA Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        _seed(session, user.id)

    with TestClient(app) as test_client:
        yield test_client

    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "sla_report_test@example.com", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.text}"
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class TestSlaComplianceReport:
    def test_alert_scoring(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        assert response.status_code == 200
        alerts = response.json()["alerts"]
        assert alerts["due"] == 3
        assert alerts["met"] == 1
        assert alerts["breached"] == 2
        assert alerts["upcoming"] == 1
        assert alerts["attainment_pct"] == pytest.approx(33.3, abs=0.1)
        assert alerts["by_severity"]["critical"] == {"due": 1, "met": 1, "breached": 0, "unknown": 0}
        assert alerts["by_severity"]["high"] == {"due": 2, "met": 0, "breached": 2, "unknown": 0}
        assert alerts["by_severity"]["medium"] == {"due": 0, "met": 0, "breached": 0, "unknown": 0}

    def test_case_scoring(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        cases = response.json()["cases"]
        assert cases["due"] == 2
        assert cases["met"] == 1
        assert cases["breached"] == 1
        assert cases["upcoming"] == 1
        assert cases["attainment_pct"] == pytest.approx(50.0, abs=0.1)
        assert cases["by_severity"]["high"] == {"due": 1, "met": 1, "breached": 0, "unknown": 0}
        assert cases["by_severity"]["medium"] == {"due": 1, "met": 0, "breached": 1, "unknown": 0}

    def test_window_is_respected(self, client, auth_headers):
        response = client.get("/api/v1/reports/sla?days=90", headers=auth_headers)
        alerts = response.json()["alerts"]
        # The 60-day-old alert joins the scored cohort at a 90-day window.
        assert alerts["due"] == 4
        assert alerts["met"] == 2

    def test_window_validation(self, client, auth_headers):
        assert client.get("/api/v1/reports/sla?days=0", headers=auth_headers).status_code == 422
        assert client.get("/api/v1/reports/sla?days=91", headers=auth_headers).status_code == 422

    def test_requires_auth(self, client):
        assert client.get("/api/v1/reports/sla").status_code == 401

    def test_owner_isolation(self, client, auth_headers):
        with TestingSessionLocal() as session:
            other = User(
                email="sla_other@example.com",
                hashed_password=get_password_hash("testpass123"),
                full_name="Other", company="Other Corp",
                is_active=True, is_verified=True,
            )
            session.add(other)
            session.commit()
            session.refresh(other)
            asset = Asset(
                user_id=other.id, name="other-router", asset_type="hardware",
                vendor="NetCo", product="EdgeOS",
            )
            session.add(asset)
            session.flush()
            session.add(Alert(
                user_id=other.id, asset_id=asset.id, title="Not yours",
                description="other owner", severity="critical", status="pending",
                created_at=_naive(days_ago=2),
                    due_date=TODAY - timedelta(days=1),
            ))
            session.commit()
        response = client.get("/api/v1/reports/sla", headers=auth_headers)
        # The other owner's overdue alert must not leak into this report.
        assert response.json()["alerts"]["due"] == 3
        exported = client.get("/api/v1/reports/sla/records/export", headers=auth_headers)
        assert exported.status_code == 200
        assert exported.json()["total"] == 3
        assert all(row["title"] != "Not yours" for row in exported.json()["records"])


def test_sla_keeps_unknown_completion_timing_separate_from_decided_outcomes(client, auth_headers):
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Legacy closed record',
                    severity='critical', status='closed',
                    due_date=TODAY - timedelta(days=1), updated_at=_naive(days_ago=2)))
        db.add(Case(user_id=user.id, title='Reopened with obsolete close time',
                    severity='critical', status='open',
                    due_date=TODAY - timedelta(days=1), closed_at=_naive(days_ago=2)))
        asset = db.query(Asset).filter_by(user_id=user.id).first()
        db.add(Alert(user_id=user.id, asset_id=asset.id, title='Legacy resolved alert',
                     description='missing timing', severity='critical', status='resolved',
                    due_date=TODAY - timedelta(days=1)))
        db.commit()
    result = client.get('/api/v1/reports/sla', headers=auth_headers).json()
    assert result['cases']['unknown'] == 1
    assert result['cases']['met'] == 1
    assert result['cases']['breached'] == 2
    assert result['cases']['attainment_pct'] == 33.3
    assert result['alerts']['unknown'] == 1
    assert result['alerts']['attainment_pct'] == 33.3
    for scope in ['cases', 'alerts']:
        bucket = result[scope]
        assert bucket['due'] == bucket['met'] + bucket['breached'] + bucket['unknown']


def test_sla_reports_no_score_when_all_completion_times_are_unknown(client, auth_headers):
    with TestingSessionLocal() as db:
        db.query(Case).delete()
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Closed without timing evidence',
                    severity='high', status='closed',
                    due_date=TODAY - timedelta(days=1), updated_at=_naive(days_ago=2)))
        db.commit()
    bucket = client.get('/api/v1/reports/sla', headers=auth_headers).json()['cases']
    assert bucket['unknown'] == bucket['due'] == 1
    assert bucket['met'] == bucket['breached'] == 0
    assert bucket['attainment_pct'] is None


def test_one_day_sla_window_does_not_include_yesterdays_due_dates(client, auth_headers):
    result = client.get('/api/v1/reports/sla?days=1', headers=auth_headers).json()
    assert result['cases']['due'] == 0
    assert result['alerts']['due'] == 0


def test_sla_records_match_summary_with_stable_pages(client, auth_headers):
    summary = client.get('/api/v1/reports/sla', headers=auth_headers).json()
    for kind in ['alerts', 'cases']:
        base = f'/api/v1/reports/sla/records?kind={kind}'
        result = client.get(base, headers=auth_headers).json()
        assert result['total'] == summary[kind]['due']
        assert len(result['records']) == result['total']
        assert result['window_start'] <= result['window_end']
        ids = [row['id'] for row in result['records']]
        pages = [
            client.get(base + f'&offset={i}&limit=1', headers=auth_headers).json()['records'][0]['id']
            for i in range(len(ids))
        ]
        assert ids == pages
        for outcome in ['met', 'breached', 'unknown']:
            filtered = client.get(base + f'&outcome={outcome}', headers=auth_headers).json()
            assert filtered['total'] == summary[kind][outcome]
            assert all(row['outcome'] == outcome for row in filtered['records'])


def test_sla_record_query_and_validation(client, auth_headers):
    path = '/api/v1/reports/sla/records'
    result = client.get(path + '?query=OVERDUE', headers=auth_headers).json()
    assert result['total'] == 1
    assert result['records'][0]['title'] == 'Overdue triage'
    client.cookies.clear()
    assert client.get(path).status_code == 401
    for params in ['kind=anything', 'outcome=anything', 'limit=101', 'limit=0', 'offset=-1', 'days=0']:
        assert client.get(path + '?' + params, headers=auth_headers).status_code == 422
    assert client.get(path + '?days=1', headers=auth_headers).json()['total'] == 0


def test_sla_records_preserve_unknown_and_reopened_evidence(client, auth_headers):
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Unscored completed record', status='closed',
                    severity='high',
                    due_date=TODAY - timedelta(days=1)))
        db.add(Case(user_id=user.id, title='Reopened after completion', status='open',
                    severity='high',
                    due_date=TODAY - timedelta(days=1), closed_at=_naive(days_ago=2)))
        other = User(email='sla_records_other@example.com', hashed_password=get_password_hash('testpass123'),
                     full_name='Other', company='Other', is_active=True, is_verified=True)
        db.add(other)
        db.flush()
        db.add(Case(user_id=other.id, title='Private foreign case', status='open',
                    severity='high',
                    due_date=TODAY - timedelta(days=1)))
        db.commit()
    result = client.get('/api/v1/reports/sla/records?kind=cases', headers=auth_headers).json()
    by_title = {row['title']: row for row in result['records']}
    assert 'Private foreign case' not in by_title
    assert by_title['Unscored completed record']['outcome'] == 'unknown'
    assert by_title['Unscored completed record']['completed_on'] is None
    assert by_title['Reopened after completion']['outcome'] == 'breached'
    assert by_title['Reopened after completion']['completed_on'] is not None


def test_sla_record_outcome_filters_use_recorded_timing(client, auth_headers):
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        db.add(Case(user_id=user.id, title='Unknown timing', status='closed', severity='high',
                    due_date=TODAY - timedelta(days=1)))
        db.add(Case(user_id=user.id, title='Reopened record', status='open', severity='high',
                    due_date=TODAY - timedelta(days=1), closed_at=_naive(days_ago=2)))
        db.commit()
    for outcome, total in [('met', 1), ('breached', 2), ('unknown', 1)]:
        result = client.get(f'/api/v1/reports/sla/records?kind=cases&outcome={outcome}', headers=auth_headers).json()
        assert result['total'] == total
        assert all(row['outcome'] == outcome for row in result['records'])


def test_sla_record_search_treats_sql_wildcards_as_literal(client, auth_headers):
    response = client.get('/api/v1/reports/sla/records?query=%25', headers=auth_headers)
    assert response.status_code == 200
    assert response.json()['total'] == 0


def test_sla_record_window_includes_both_boundary_dates(client, auth_headers):
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='sla_report_test@example.com').one()
        for days_ago in [0, 6, 7]:
            db.add(Case(user_id=user.id, title=f'Boundary record {days_ago}', status='open',
                        severity='high',
                    due_date=TODAY - timedelta(days=days_ago)))
        db.commit()
    result = client.get('/api/v1/reports/sla/records?kind=cases&days=7&query=Boundary', headers=auth_headers).json()
    assert [row['title'] for row in result['records']] == ['Boundary record 6', 'Boundary record 0']
    assert result['total'] == 2


def test_complete_sla_export_matches_paged_owner_scoped_cohort(client, auth_headers):
    path = '/api/v1/reports/sla/records'
    response = client.get(path + '/export', params={'kind': 'alerts', 'days': 30}, headers=auth_headers)
    assert response.status_code == 200, response.text
    data = response.json()
    page = client.get(path, params={'kind': 'alerts', 'days': 30, 'limit': 1}, headers=auth_headers).json()
    assert data['complete'] is True and data['format'] == 'onealert-sla-evidence-v1'
    assert len(data['records']) == data['total'] == page['total'] > 1
    assert data['records'][0] == page['records'][0]
    assert data['window_start'] == page['window_start'] and data['window_end'] == page['window_end']
    filtered = client.get(path + '/export', params={'kind': 'alerts', 'outcome': 'breached', 'query': 'Overdue'}, headers=auth_headers).json()
    assert filtered['total'] == 1 and filtered['records'][0]['title'] == 'Overdue triage'
    assert filtered['records'][0]['outcome'] == 'breached'
    assert client.get(path + '/export', params={'days': 91}, headers=auth_headers).status_code == 422
    assert client.get(path + '/export', params={'kind': 'other'}, headers=auth_headers).status_code == 422


def test_complete_sla_export_refuses_over_limit_without_partial_file(client, auth_headers, monkeypatch):
    monkeypatch.setattr('backend.routers.reports.SLA_EVIDENCE_EXPORT_LIMIT', 2)
    path = '/api/v1/reports/sla/records/export'
    response = client.get(path, headers=auth_headers)
    assert response.status_code == 422 and 'No partial export' in response.text
    exact = client.get(path, params={'outcome': 'breached'}, headers=auth_headers)
    assert exact.status_code == 200, exact.text
    assert exact.json()['total'] == len(exact.json()['records']) == 2
    empty = client.get(path, params={'query': 'not present'}, headers=auth_headers)
    assert empty.status_code == 200 and empty.json()['records'] == []


def test_complete_case_export_keeps_unknown_completion_evidence(client, auth_headers):
    with TestingSessionLocal() as db:
        db.add(Case(user_id=1, title='Unknown export timing', severity='high',
                    status='closed', due_date=TODAY, closed_at=None))
        db.commit()
    response = client.get('/api/v1/reports/sla/records/export', params={'kind': 'cases', 'outcome': 'unknown'}, headers=auth_headers)
    assert response.status_code == 200, response.text
    assert any(row['title'] == 'Unknown export timing' and row['completed_on'] is None for row in response.json()['records'])
