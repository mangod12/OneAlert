"""Saved notification policy previews use runtime predicates and never dispatch or mutate."""

import itertools
import json
from datetime import time
from pathlib import Path
from types import SimpleNamespace
from typing import get_args

import pytest
from test_notification_preferences import _register_and_login, _TestingSessionLocal
from test_notification_preferences import client as client

from backend.models.audit_log import AuditLog
from backend.models.notification import Notification
from backend.models.user import User
from backend.routers.notification_policy import Scenario, policy_evaluation, policy_fingerprint, saved_policy
from backend.services.notification_prefs import should_email_event, should_email_user

DEFAULTS = dict(email_notifications_enabled=True, notify_min_severity='high', muted_kinds=[],
                quiet_hours_start='22:00', quiet_hours_end='06:00', digest_enabled=True, digest_hour_utc=7)


def user(**changes):
    return SimpleNamespace(**{**DEFAULTS, **changes})


def test_decisions_and_every_matrix_row_match_actual_runtime_across_supported_scenarios():
    for scenario, enabled, muted, minimum, hour, window in itertools.product(
        get_args(Scenario), (True, False), (True, False), ('low', 'medium', 'high', 'critical', 'bad', ''),
        (0, 5, 6, 12, 21, 22, 23), ('overnight', 'day', 'zero', 'unset', 'incomplete'),
    ):
        kind = 'alert_created' if scenario == 'new_alert' else scenario
        start, end = {'overnight': ('22:00', '06:00'), 'day': ('09:00', '17:00'), 'zero': ('12:00', '12:00'),
                      'unset': (None, None), 'incomplete': ('22:00', None)}[window]
        subject = user(email_notifications_enabled=enabled, muted_kinds=[kind] if muted else [],
                       notify_min_severity=minimum, quiet_hours_start=start, quiet_hours_end=end)
        result = policy_evaluation(subject, scenario, 'high', time(hour))
        assert result['feed_kind_hidden_by_saved_mute'] is muted
        for row in result['severity_matrix']:
            expected = (should_email_user(subject, row['severity'], time(hour)) if scenario == 'new_alert'
                        else should_email_event(subject, kind, row['severity'], time(hour)))
            assert row['allowed_by_preference_predicate'] is expected
            assert (not row['blocking_reasons']) is expected
        assert result['selected'] == result['severity_matrix'][2]


@pytest.mark.parametrize('clock,inside', [('21:59', False), ('22:00', True), ('05:59', True), ('06:00', False)])
def test_quiet_boundaries_critical_bypass_and_unknown_severity(clock, inside):
    subject = user(notify_min_severity='critical')
    result = policy_evaluation(subject, 'case_assigned', None, time.fromisoformat(clock))
    assert result['gates']['inside_quiet_hours'] is inside
    assert result['selected']['blocking_reasons'] == (['quiet_hours'] if inside else [])
    assert result['severity_matrix'][3]['allowed_by_preference_predicate'] is True
    assert result['severity_matrix'][2]['allowed_by_preference_predicate'] is False
    subject.email_notifications_enabled = False
    assert policy_evaluation(subject, 'case_assigned', 'critical', time.fromisoformat(clock))['selected'] == {
        'severity': 'critical', 'allowed_by_preference_predicate': False, 'blocking_reasons': ['email_disabled'],
    }


def test_muted_new_alert_kind_hides_feed_but_does_not_gate_its_immediate_email_predicate():
    subject = user(muted_kinds=['alert_created', 'case_updated'])
    new = policy_evaluation(subject, 'new_alert', 'critical', time(23))
    assert new['selected']['allowed_by_preference_predicate'] is True
    assert new['gates']['kind_is_muted'] is True and new['gates']['kind_gate_applies'] is False
    assert new['feed_kind_hidden_by_saved_mute'] is True
    investigation = policy_evaluation(subject, 'case_updated', 'critical', time(23))
    assert investigation['selected']['blocking_reasons'] == ['kind_muted']


def test_legacy_unknown_minimum_has_the_actual_medium_fallback_and_empty_minimum_defaults_low():
    assert policy_evaluation(user(notify_min_severity='legacy'), 'new_alert', 'low', time(12))['gates'] == {
        'email_enabled': True, 'kind_is_muted': False, 'kind_gate_applies': False,
        'quiet_window_state': 'configured', 'inside_quiet_hours': False, 'critical_quiet_bypass': False,
        'effective_minimum': 'medium', 'minimum_fallback': True, 'unknown_severity': False,
        'severity_meets_minimum': False,
    }
    empty = policy_evaluation(user(notify_min_severity=''), 'new_alert', 'low', time(12))
    assert empty['gates']['effective_minimum'] == 'low' and not empty['gates']['minimum_fallback']


def test_saved_projection_hash_is_complete_order_independent_and_contains_no_contact_or_webhook_secrets():
    subject = user()
    subject.email = 'not-in-preview@example.test'
    subject.slack_webhook_url = 'not-in-preview-private-destination'
    snapshot = saved_policy(subject)
    assert set(snapshot) == set(DEFAULTS)
    assert 'not-in-preview' not in json.dumps(snapshot)
    assert policy_fingerprint(snapshot) == policy_fingerprint(dict(reversed(list(snapshot.items()))))
    assert policy_fingerprint({**snapshot, 'digest_hour_utc': 8}) != policy_fingerprint(snapshot)


def read(client, headers):
    response = client.get('/api/v1/notifications/policy-review', headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def payload(raw, **changes):
    return {**dict(expected_fingerprint=raw['preferences_fingerprint'], scenario='case_assigned',
                   severity='high', utc_time='23:00'), **changes}


def preview(client, headers, body):
    return client.post('/api/v1/notifications/policy-preview',
                       headers={**headers, 'Content-Type': 'application/json'}, content=json.dumps(body))


def test_authenticated_read_preview_and_current_clock_never_write_or_dispatch(client, monkeypatch):
    async def no_dispatch(*args, **kwargs):
        raise AssertionError('A read-only policy preview must never dispatch')
    monkeypatch.setattr('backend.services.investigation_notify.notify_investigation_event', no_dispatch)
    monkeypatch.setattr('backend.services.email_alert.email_service.send_investigation_event', no_dispatch)
    monkeypatch.setattr('backend.services.email_alert.email_service.send_vulnerability_alert', no_dispatch)
    headers = _register_and_login(client, 'preview@example.com')
    with _TestingSessionLocal() as db:
        subject = db.query(User).filter_by(email='preview@example.com').one()
        for key, value in DEFAULTS.items():
            setattr(subject, key, value)
        db.commit()
        before = (db.query(Notification).count(), db.query(AuditLog).count(), saved_policy(subject))
    raw = read(client, headers)
    assert raw['version'] == 1 and raw['preferences_fingerprint'] == policy_fingerprint(DEFAULTS)
    assert raw['preferences'] == DEFAULTS
    response = preview(client, headers, payload(raw))
    assert response.status_code == 200
    data = response.json()
    assert data['time_basis'] == 'chosen_utc_clock' and data['tested_utc_time'] == '23:00'
    assert data['request'] == dict(scenario='case_assigned', severity='high', utc_time='23:00')
    assert data['selected']['blocking_reasons'] == ['quiet_hours']
    assert data['severity_matrix'][3]['blocking_reasons'] == []
    assert 'preview@example.com' not in response.text and 'webhook' not in response.text
    current_body = payload(raw)
    current_body['utc_time'] = None
    current = preview(client, headers, current_body).json()
    assert current['time_basis'] == 'current_utc' and current['tested_utc_time'] == current['retrieved_at'][11:16]
    with _TestingSessionLocal() as db:
        subject = db.query(User).filter_by(email='preview@example.com').one()
        assert (db.query(Notification).count(), db.query(AuditLog).count(), saved_policy(subject)) == before


@pytest.mark.parametrize('field,value', [
    ('email_notifications_enabled', False), ('notify_min_severity', 'critical'), ('muted_kinds', ['case_assigned']),
    ('quiet_hours_start', '21:00'), ('quiet_hours_end', '08:00'), ('digest_enabled', True), ('digest_hour_utc', 8),
])
def test_changed_saved_preferences_refuse_mixed_snapshot_preview(client, field, value):
    headers = _register_and_login(client, 'stale@example.com')
    raw = read(client, headers)
    with _TestingSessionLocal() as db:
        setattr(db.query(User).filter_by(email='stale@example.com').one(), field, value)
        db.commit()
    response = preview(client, headers, payload(raw))
    assert response.status_code == 409 and 'severity_matrix' not in response.json()


@pytest.mark.parametrize('change', [
    {'scenario': 'alert_assigned'}, {'scenario': 'unknown'}, {'severity': 'HIGH'}, {'severity': 'unknown'},
    {'severity': 1}, {'utc_time': '24:00'}, {'utc_time': '9:00'}, {'utc_time': '22:00\n'},
    {'utc_time': '22:00:00'}, {'utc_time': False}, {'expected_fingerprint': 'a' * 63},
    {'extra': 'forbidden'}, {'extra': '\ud800'},
    {'extra': float('nan')}, {'severity': float('inf')}, {'utc_time': float('-inf')},
])
def test_strict_request_refuses_unknown_dispatch_paths_implicit_coercion_or_unencodable_errors(client, change):
    headers = _register_and_login(client, 'contract@example.com')
    raw = read(client, headers)
    response = preview(client, headers, {**payload(raw), **change})
    assert response.status_code == 422


@pytest.mark.parametrize('field,value', [
    ('quiet_hours_start', 'invalid'), ('quiet_hours_end', '06:00\n'), ('quiet_hours_start', '0४:01'),
    ('digest_hour_utc', 24), ('muted_kinds', ['x' * 101]),
])
def test_unsupported_legacy_saved_values_fail_closed_instead_of_reinterpreting_runtime_inputs(client, field, value):
    headers = _register_and_login(client, 'legacy@example.com')
    with _TestingSessionLocal() as db:
        setattr(db.query(User).filter_by(email='legacy@example.com').one(), field, value)
        db.commit()
    assert client.get('/api/v1/notifications/policy-review', headers=headers).status_code == 422


def test_multiple_accounts_only_read_current_user_and_inactive_or_unauthenticated_calls_are_refused(client):
    first = _register_and_login(client, 'first@example.com')
    second = _register_and_login(client, 'second@example.com')
    with _TestingSessionLocal() as db:
        db.query(User).filter_by(email='first@example.com').one().notify_min_severity = 'critical'
        db.commit()
    assert read(client, first)['preferences']['notify_min_severity'] == 'critical'
    second_raw = read(client, second)
    assert second_raw['preferences']['notify_min_severity'] == 'low'
    assert preview(client, first, payload(second_raw)).status_code == 409
    client.cookies.clear()
    assert client.get('/api/v1/notifications/policy-review').status_code == 401
    assert preview(client, {}, payload(second_raw)).status_code == 401
    with _TestingSessionLocal() as db:
        db.query(User).filter_by(email='second@example.com').one().is_active = False
        db.commit()
    assert client.get('/api/v1/notifications/policy-review', headers=second).status_code == 403
    assert preview(client, second, payload(second_raw)).status_code == 403


def test_shared_frontend_backend_policy_vector():
    raw = json.loads((Path(__file__).parent / 'fixtures' / 'notification-policy-v1.json').read_text())
    assert policy_fingerprint(raw['preferences']) == raw['preferences_fingerprint']
    request = raw['request']
    evaluation = policy_evaluation(SimpleNamespace(**raw['preferences']), request['scenario'], request['severity'],
                                   time.fromisoformat(request['utc_time']))
    assert all(raw[key] == value for key, value in evaluation.items())
