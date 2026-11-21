"""Repeated saved-rotation writes must not restart a running weekly handoff."""
from datetime import UTC, date, datetime

from test_on_call import _make_admin, _register_and_login, _share_org, _TestingSessionLocal, _user_id
from test_on_call import client as client

from backend.models.organization import Organization


def test_equivalent_rotation_retry_preserves_anchor_and_current_member(client, monkeypatch):
    import backend.routers.organizations as routes
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 11, 21, 8, 0, tzinfo=UTC)
    monkeypatch.setattr(routes, 'datetime', Clock)
    first_headers = _register_and_login(client, 'anchor-admin@example.com')
    first = _user_id(client, first_headers)
    second_headers = _register_and_login(client, 'anchor-peer@example.com')
    second = _user_id(client, second_headers)
    org_id = _share_org(first, second)
    _make_admin(first)
    with _TestingSessionLocal() as db:
        org = db.get(Organization, org_id)
        org.on_call_member_ids = [first, second]
        org.on_call_anchor_date = date(2026, 11, 14)
        db.commit()
    before = client.get('/api/v1/orgs/me/on-call', headers=first_headers).json()
    assert before['current_member_id'] == second
    for ids in ([first, second], [first, first, second]):
        response = client.patch('/api/v1/orgs/me/on-call', headers=first_headers, json={'member_ids': ids})
        assert response.status_code == 200
        assert response.json() == before
    # A real order change still starts a new rotation with the chosen first member.
    changed = client.patch('/api/v1/orgs/me/on-call', headers=first_headers,
                           json={'member_ids': [second, first]})
    assert changed.status_code == 200
    assert changed.json()['anchor_date'] == '2026-11-21'
    assert changed.json()['current_member_id'] == second
    cleared = client.patch('/api/v1/orgs/me/on-call', headers=first_headers, json={'member_ids': []})
    assert cleared.json() == {'member_ids': [], 'anchor_date': None, 'current_member_id': None}


def test_equal_members_with_missing_anchor_repair_configuration(client):
    headers = _register_and_login(client, 'missing-anchor@example.com')
    owner = _user_id(client, headers)
    org_id = _share_org(owner)
    _make_admin(owner)
    with _TestingSessionLocal() as db:
        org = db.get(Organization, org_id)
        org.on_call_member_ids = [owner]
        org.on_call_anchor_date = None
        db.commit()
    response = client.patch('/api/v1/orgs/me/on-call', headers=headers, json={'member_ids': [owner]})
    assert response.status_code == 200
    assert response.json()['anchor_date'] is not None
    assert response.json()['current_member_id'] == owner
