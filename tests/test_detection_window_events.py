"""Owned detection receipts lead only to their current bounded event windows."""
import json
from datetime import UTC, datetime, timedelta

import pytest
from test_agent_run_detail import ledger as ledger

from backend.main import app
from backend.models.case import AgentRun, AgentStep
from backend.models.security_event import SecurityEvent
from backend.routers.auth import get_current_user
from backend.routers.detection_window_events import receipt_window

START = datetime(2026, 11, 1, tzinfo=UTC)
END = START + timedelta(hours=24)


def saved(run_id):
    return {'format': 'onealert-detection-review', 'version': 1, 'run_id': run_id,
            'window_from': START.isoformat(), 'window_until': END.isoformat(), 'total_events': 99}


def seed(ledger):
    _client, owner, other, _, sessions = ledger
    with sessions() as db:
        run = AgentRun(user_id=owner.id, agent_type='detect', status='partial')
        db.add(run)
        db.flush()
        step = AgentStep(run_id=run.id, step_number=1, action='detection_review_receipt',
                         tool_used='bounded_detection_review', output_summary=json.dumps(saved(run.id)))
        db.add(step)
        db.add_all(SecurityEvent(user_id=owner.id, timestamp=START, event_type='alert',
                                signature='😀' * 400, source_ip='', raw_data={'private': 'EXCLUDED'})
                   for _ in range(22))
        db.add_all(SecurityEvent(user_id=user, timestamp=stamp, event_type='dns')
                   for user, stamp in [(owner.id, END), (other.id, START),
                                       (owner.id, START - timedelta(microseconds=1)),
                                       (owner.id, END + timedelta(microseconds=1))])
        db.commit()
        return f'/api/v1/cases/agents/runs/{run.id}/detection-receipts/{step.id}/events', run.id, step.id


def test_complete_exact_inclusive_window_pages_are_owned_bounded_and_not_a_snapshot(ledger):
    path, run_id, step_id = seed(ledger)
    client = ledger[0]
    pages = [client.get(path, params={'page': page, 'started_at': '1970-01-01',
                                      'ended_before': '2099-01-01'}).json() for page in (1, 2, 3)]
    assert [len(p['records']) for p in pages] == [10, 10, 3]
    assert all(p['total'] == 23 and p['recorded_total_events'] == 99 for p in pages)
    assert all(p['run_id'] == run_id and p['step_id'] == step_id for p in pages)
    ids = [r['id'] for p in pages for r in p['records']]
    assert ids == sorted(ids) and len(set(ids)) == 23
    assert pages[-1]['records'][-1]['timestamp'] == END.isoformat()
    row = pages[0]['records'][0]
    assert row['signature'] == '😀' * 300 and row['shortened_fields'] == ['signature']
    assert row['source_ip'] == '' and row['dest_ip'] is None
    assert 'EXCLUDED' not in str(pages) and 'raw_data' not in str(pages) and 'user_id' not in row
    assert client.get(path, params={'page': 99}).json()['records'] == []
    with ledger[-1]() as db:
        assert db.query(SecurityEvent).count() == 26
        assert db.query(AgentRun).count() == 2 and db.query(AgentStep).count() == 3


def test_foreign_admin_wrong_run_wrong_step_and_missing_cannot_recover_saved_scope(ledger):
    path, run_id, step_id = seed(ledger)
    client, owner, other, original_run, _sessions = ledger
    for bad in [path.replace(f'/runs/{run_id}/', '/runs/999999/'),
                path.replace(f'/runs/{run_id}/', f'/runs/{original_run}/'),
                path.replace(f'/detection-receipts/{step_id}/', '/detection-receipts/999999/')]:
        assert client.get(bad).status_code == 404
    other.role = 'admin'
    app.dependency_overrides[get_current_user] = lambda: other
    assert client.get(path).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: owner
    owner.is_active = False
    assert client.get(path).status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.get(path).status_code == 401


@pytest.mark.parametrize('change', [{'action': 'other'}, {'tool_used': 'other'},
                                   {'output_summary': '{broken'}, {'output_summary': '{}'}])
def test_unsupported_receipt_never_falls_back_to_a_wider_window(ledger, change):
    path, _, step_id = seed(ledger)
    with ledger[-1]() as db:
        step = db.get(AgentStep, step_id)
        for key, value in change.items():
            setattr(step, key, value)
        db.commit()
    assert ledger[0].get(path).status_code == (409 if 'output_summary' in change else 404)


@pytest.mark.parametrize('change', [{'version': True}, {'version': 2}, {'run_id': True},
    {'run_id': 2}, {'total_events': True}, {'total_events': -1},
    {'window_from': '2026-11-01T00:00:00'}, {'window_until': START.isoformat()},
    {'window_until': (START + timedelta(hours=169)).isoformat()}, {'window_from': None},
    {'window_from': '0001-01-01T00:00:00+14:00'}])
def test_invalid_saved_scope_is_not_replaced_with_defaults(change):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as denied:
        receipt_window(json.dumps({**saved(1), **change}), 1)
    assert denied.value.status_code == 409


@pytest.mark.parametrize('params', [{'page': 0}, {'page': 2147483648}, {'size': 0}, {'size': 101}])
def test_page_bounds(ledger, params):
    path, _, _ = seed(ledger)
    assert ledger[0].get(path, params=params).status_code == 422
