"""Read-only UTC on-call forecast uses the existing saved assignment rule."""
from datetime import UTC, date, datetime, timedelta

from test_on_call import _register_and_login, _share_org, _TestingSessionLocal, _user_id
from test_on_call import client as client

from backend.models.organization import Organization
from backend.models.user import User
from backend.services.oncall import rotation_coverage, rotation_member_id


def test_periods_cover_exact_horizon_with_partial_weeks_and_existing_anchor_semantics():
    today, anchor = date(2026, 11, 21), date(2026, 11, 18)
    for ids, start in [([1, 2, 3], anchor), ([1], anchor), ([1, 2], today + timedelta(days=20))]:
        slots = rotation_coverage(ids, start, today)
        days = [(slot['from_date'] + timedelta(days=offset), slot['scheduled_member_id'])
                for slot in slots for offset in range((slot['until_exclusive'] - slot['from_date']).days)]
        assert len(days) == len({day for day, _ in days}) == 56
        assert slots[0]['from_date'] == today and slots[-1]['until_exclusive'] == today + timedelta(days=56)
        assert all(member == rotation_member_id(ids, start, day) for day, member in days)
        assert len(slots) <= 9
    assert rotation_coverage([], anchor, today) == []


def test_owner_scoped_roster_and_unavailable_periods_without_changing_rotation(client, monkeypatch):
    import backend.routers.organizations as routes
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 11, 21, 8, 0, tzinfo=UTC)
    monkeypatch.setattr(routes, 'datetime', Clock)
    headers = _register_and_login(client, 'coverage@example.com')
    owner = _user_id(client, headers)
    inactive_headers = _register_and_login(client, 'inactive@example.com')
    inactive = _user_id(client, inactive_headers)
    foreign_headers = _register_and_login(client, 'foreign@example.com')
    foreign = _user_id(client, foreign_headers)
    org_id = _share_org(owner, inactive)
    with _TestingSessionLocal() as db:
        db.get(User, inactive).is_active = False
        org = db.get(Organization, org_id)
        org.on_call_member_ids = [owner, inactive, foreign]
        org.on_call_anchor_date = date(2026, 11, 21)
        db.commit()
    response = client.get('/api/v1/orgs/me/on-call/coverage', headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data['timezone'] == 'UTC' and data['from_date'] == '2026-11-21'
    assert data['until_exclusive'] == '2027-01-16' and data['active_member_count'] == 1
    assert data['coverage'][0]['member_id'] == owner
    unavailable = [slot for slot in data['coverage'] if not slot['on_call_override_available']]
    assert unavailable and all(slot['member_name'] is None and slot['member_id'] is None for slot in unavailable)
    assert 'inactive@example.com' not in response.text and 'foreign@example.com' not in response.text
    with _TestingSessionLocal() as db:
        org = db.get(Organization, org_id)
        assert org.on_call_member_ids == [owner, inactive, foreign]
        assert org.on_call_anchor_date == date(2026, 11, 21)
    assert client.get('/api/v1/orgs/me/on-call/coverage', headers=foreign_headers).status_code == 404


def test_disabled_rotation_and_missing_org(client):
    headers = _register_and_login(client, 'disabled-coverage@example.com')
    assert client.get('/api/v1/orgs/me/on-call/coverage', headers=headers).status_code == 404
    owner = _user_id(client, headers)
    _share_org(owner)
    data = client.get('/api/v1/orgs/me/on-call/coverage', headers=headers).json()
    assert data['configured'] is False and data['coverage'] == []
    client.cookies.clear()
    assert client.get('/api/v1/orgs/me/on-call/coverage').status_code == 401
