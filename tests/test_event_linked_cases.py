"""Reverse evidence links never widen event or investigation ownership."""
from datetime import UTC, datetime

import pytest
from test_events_export import _make_event, _register_and_login, _TestingSessionLocal
from test_events_export import client as client

from backend.models.case import Case, CaseEvent
from backend.models.user import User


def seed_cases(client, headers, event, count=23):
    owner = client.get('/api/v1/auth/me', headers=headers).json()['id']
    ids = []
    with _TestingSessionLocal() as db:
        for index in range(count):
            case = Case(user_id=owner, title=f'Linked investigation {index}', status='closed' if index % 2 else 'open',
                        summary='PRIVATE SUMMARY', resolution='PRIVATE RESOLUTION',
                        created_at=datetime(2026, 11, 1, tzinfo=UTC))
            db.add(case)
            db.flush()
            ids.append(case.id)
            db.add_all([CaseEvent(case_id=case.id, event_id=event), CaseEvent(case_id=case.id, event_id=event)])
        db.commit()
    return ids


def test_complete_stable_distinct_reverse_links_and_exact_status_counts(client):
    headers = _register_and_login(client, 'linked-case-owner@example.com')
    event = _make_event(client, headers)
    ids = seed_cases(client, headers, event)
    path = f'/api/v1/events/{event}/linked-investigations'
    responses = [client.get(path, headers=headers, params={'page': page}) for page in (1, 2, 3)]
    assert all(response.status_code == 200 for response in responses)
    pages = [response.json() for response in responses]
    assert [len(page['records']) for page in pages] == [10, 10, 3]
    assert [row['id'] for page in pages for row in page['records']] == sorted(ids, reverse=True)
    assert all(page['total'] == page['available_count'] == 23 for page in pages)
    closed = client.get(path, headers=headers, params={'status': 'closed', 'size': 100}).json()
    assert closed['total'] == 11 and closed['available_count'] == 23
    assert all(row['status'] == 'closed' for row in closed['records'])
    assert 'PRIVATE' not in str(pages) and 'user_id' not in str(pages)
    assert client.get(path, headers=headers, params={'page': 100}).json()['records'] == []


def test_cross_owner_admin_and_broken_links_reveal_no_private_case_counts(client):
    owner = _register_and_login(client, 'linked-private-owner@example.com')
    other = _register_and_login(client, 'linked-private-other@example.com')
    event = _make_event(client, owner)
    foreign_event = _make_event(client, other)
    own_cases = seed_cases(client, owner, event, 1)
    foreign_cases = seed_cases(client, other, foreign_event, 1)
    with _TestingSessionLocal() as db:
        db.add_all([CaseEvent(case_id=foreign_cases[0], event_id=event), CaseEvent(case_id=999999, event_id=event)])
        db.query(User).filter(User.email == 'linked-private-other@example.com').one().role = 'admin'
        db.commit()
    path = f'/api/v1/events/{event}/linked-investigations'
    result = client.get(path, headers=owner).json()
    assert result['available_count'] == result['total'] == 1
    assert [row['id'] for row in result['records']] == own_cases
    assert client.get(path, headers=other).status_code == 404
    assert client.get('/api/v1/events/999999/linked-investigations', headers=owner).status_code == 404


def test_empty_and_inactive_and_unauthenticated(client):
    headers = _register_and_login(client, 'linked-case-auth@example.com')
    event = _make_event(client, headers)
    path = f'/api/v1/events/{event}/linked-investigations'
    result = client.get(path, headers=headers).json()
    assert result['records'] == [] and result['total'] == result['available_count'] == 0
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'linked-case-auth@example.com').one().is_active = False
        db.commit()
    assert client.get(path, headers=headers).status_code == 403
    client.cookies.clear()
    assert client.get(path).status_code == 401


@pytest.mark.parametrize('params', [{'status': 'all,open'}, {'status': 'unknown'}, {'page': 0},
    {'size': 0}, {'size': 101}, {'page': 999999999999999999999999}])
def test_invalid_filters_and_pages_are_refused(client, params):
    headers = _register_and_login(client, 'linked-case-invalid@example.com')
    event = _make_event(client, headers)
    assert client.get(f'/api/v1/events/{event}/linked-investigations',
                      headers=headers, params=params).status_code == 422
