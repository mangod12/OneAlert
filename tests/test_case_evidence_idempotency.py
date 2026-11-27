"""Concurrent and legacy-duplicate evidence links retain idempotent owner-scoped behavior."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_case_create import (
    TestCaseAlertLinking as AlertHelper,
)
from test_case_create import (
    TestCaseEventLinking as EventHelper,
)
from test_case_create import _TestingSessionLocal
from test_case_create import client as client
from test_case_create import seed_investigation_actor as register_and_login

from backend.models.case import Case, CaseAlert, CaseEvent, CaseTimeline


def prepare(client, kind):
    headers = register_and_login(client, 'evidence-idempotency@example.com')
    helper = AlertHelper() if kind == 'alert' else EventHelper()
    case_id = helper._make_case(client, headers)
    identity = helper._make_alert(client, headers) if kind == 'alert' else helper._make_event(client, headers)
    return headers, case_id, identity, CaseAlert if kind == 'alert' else CaseEvent


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_concurrent_repeated_links_create_one_reference_and_one_timeline_entry(client, kind):
    headers, case_id, identity, model = prepare(client, kind)
    url = f'/api/v1/cases/{case_id}/{kind}s/{identity}'
    def link(_):
        response = client.post(url, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()['data']['linked']
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(link, range(2)))
    assert sorted(results) == [False, True]
    with _TestingSessionLocal() as db:
        assert db.query(model).filter_by(case_id=case_id).count() == 1
        assert db.query(CaseTimeline).filter_by(case_id=case_id, entry_type=kind).count() == 1
        before = db.get(Case, case_id).updated_at
    assert client.post(url, headers=headers).json()['data']['linked'] is False
    with _TestingSessionLocal() as db:
        assert db.get(Case, case_id).updated_at == before


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_legacy_duplicate_links_are_a_noop_and_unlink_removes_only_exact_case_references(client, kind):
    headers, case_id, identity, model = prepare(client, kind)
    with _TestingSessionLocal() as db:
        owner = db.get(Case, case_id).user_id
        other = Case(user_id=owner, title='Other investigation', severity='high')
        db.add(other)
        db.flush()
        other_id = other.id
        for destination in [case_id, case_id, other_id]:
            db.add(model(**{'case_id': destination, f'{kind}_id': identity}))
        db.commit()
    url = f'/api/v1/cases/{case_id}/{kind}s/{identity}'
    assert client.post(url, headers=headers).json()['data']['linked'] is False
    assert client.delete(url, headers=headers).json()['data']['unlinked'] is True
    assert client.delete(url, headers=headers).json()['data']['unlinked'] is False
    with _TestingSessionLocal() as db:
        assert db.query(model).filter_by(case_id=case_id).count() == 0
        assert db.query(model).filter_by(case_id=other_id).count() == 1
        entries = db.query(CaseTimeline).filter_by(case_id=case_id, entry_type=kind).all()
        assert len(entries) == 1 and 'unlinked' in entries[0].content


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_concurrent_unlinks_remove_reference_and_record_one_transition(client, kind):
    headers, case_id, identity, model = prepare(client, kind)
    url = f'/api/v1/cases/{case_id}/{kind}s/{identity}'
    assert client.post(url, headers=headers).status_code == 200
    def unlink(_):
        response = client.delete(url, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()['data']['unlinked']
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(unlink, range(2)))
    assert sorted(results) == [False, True]
    with _TestingSessionLocal() as db:
        assert db.query(model).filter_by(case_id=case_id).count() == 0
        assert sum('unlinked' in entry.content for entry in
                   db.query(CaseTimeline).filter_by(case_id=case_id, entry_type=kind)) == 1
