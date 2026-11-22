"""Reviewed rule status changes are owner-scoped conditional updates, not alert mutation."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Update
from test_suppression_rules import AsyncTestingSessionLocal, TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User
from backend.services.alert_checker import _apply_suppression_rules
from backend.services.suppression_review import suppression_rule_fingerprint


def read(client, headers):
    rules = client.get('/api/v1/suppression-rules/', headers=headers).json()
    identity = rules[0]['id']
    response = client.get(f'/api/v1/suppression-rules/{identity}/matching-alerts', headers=headers)
    assert response.status_code == 200
    return identity, response.json()


def apply(client, headers, identity, fingerprint, enabled=False):
    return client.post(f'/api/v1/suppression-rules/{identity}/reviewed-status', headers=headers,
                       json={'expected_fingerprint': fingerprint, 'enabled': enabled})


def test_review_binding_and_exact_conditional_pause_enable_without_mutating_alerts(client, auth_headers):
    identity, before = read(client, auth_headers)
    assert before['rule_fingerprint'] == suppression_rule_fingerprint(before['rule'])
    with TestingSessionLocal() as db:
        original_alerts = [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()]
    paused = apply(client, auth_headers, identity, before['rule_fingerprint'])
    assert paused.status_code == 200
    data = paused.json()
    assert data['conditional_update_applied'] is True
    assert data['reviewed_fingerprint'] == before['rule_fingerprint']
    assert data['rule'] == {**before['rule'], 'enabled': False}
    assert data['rule_fingerprint'] == suppression_rule_fingerprint(data['rule']) != before['rule_fingerprint']
    assert apply(client, auth_headers, identity, before['rule_fingerprint']).status_code == 409
    enabled = apply(client, auth_headers, identity, data['rule_fingerprint'], True)
    assert enabled.status_code == 200 and enabled.json()['rule']['enabled'] is True
    with TestingSessionLocal() as db:
        assert [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()] == original_alerts
        logs = db.query(AuditLog).filter_by(action='reviewed_suppression_status').all()
        assert len(logs) == 2 and all(row.target_id == identity for row in logs)
        assert all('fingerprint' not in row.detail and 'ransomware' not in row.detail for row in logs)


@pytest.mark.parametrize('field,value', [
    ('name', 'A different saved rule'), ('cve_id', 'CVE-2026-9000'), ('severity', 'high'),
    ('title_contains', 'Different %_ literal'), ('duration_hours', 12), ('enabled', False),
    ('created_at', datetime(2025, 1, 1, tzinfo=UTC)),
])
def test_stale_review_never_changes_a_revised_rule(client, auth_headers, field, value):
    identity, before = read(client, auth_headers)
    with TestingSessionLocal() as db:
        setattr(db.get(AlertSuppressionRule, identity), field, value)
        db.commit()
    response = apply(client, auth_headers, identity, before['rule_fingerprint'])
    assert response.status_code == 409 and 'No status change' in response.text
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        assert rule.enabled is (value if field == 'enabled' else True)
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_status').count()


@pytest.mark.parametrize('field,value', [
    ('name', 'Concurrent name'), ('cve_id', 'CVE-2026-9000'), ('severity', 'critical'),
    ('title_contains', 'Concurrent criterion'), ('duration_hours', 11), ('enabled', False),
    ('created_at', datetime(2025, 1, 1, tzinfo=UTC)), ('user_id', 999),
])
def test_atomic_where_checks_every_saved_value_after_fingerprint_read(client, auth_headers, monkeypatch, field, value):
    identity, before = read(client, auth_headers)
    original = AsyncSession.execute
    raced = []

    async def execute(session, statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == 'alert_suppression_rules' and not raced:
            raced.append(True)
            with TestingSessionLocal() as other:
                other.execute(update(AlertSuppressionRule).where(
                    AlertSuppressionRule.id == identity,
                ).values(**{field: value}))
                other.commit()
        return await original(session, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, 'execute', execute)
    response = apply(client, auth_headers, identity, before['rule_fingerprint'])
    assert raced and response.status_code == 409
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        assert rule.enabled is (value if field == 'enabled' else True)
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_status').count()


def test_asset_criteria_are_in_atomic_comparison(client, auth_headers, monkeypatch):
    identity, before = read(client, auth_headers)
    original = AsyncSession.execute
    raced = []

    async def execute(session, statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == 'alert_suppression_rules' and not raced:
            raced.append(True)
            with TestingSessionLocal() as other:
                asset_id = other.query(Alert).first().asset_id
                other.execute(update(AlertSuppressionRule).where(
                    AlertSuppressionRule.id == identity,
                ).values(asset_id=asset_id))
                other.commit()
        return await original(session, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, 'execute', execute)
    assert apply(client, auth_headers, identity, before['rule_fingerprint']).status_code == 409
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).enabled is True


def test_foreign_missing_inactive_and_unauthenticated_requests_do_not_write(client, auth_headers):
    identity, before = read(client, auth_headers)
    with TestingSessionLocal() as db:
        foreign = AlertSuppressionRule(user_id=999, name='Foreign private', title_contains='private', enabled=True)
        db.add(foreign)
        db.commit()
        foreign_id = foreign.id
    for value in [foreign_id, 999999]:
        response = apply(client, auth_headers, value, before['rule_fingerprint'])
        assert response.status_code == 404 and 'private' not in response.text
    client.cookies.clear()
    assert client.post(f'/api/v1/suppression-rules/{identity}/reviewed-status', json={
        'enabled': False, 'expected_fingerprint': before['rule_fingerprint'],
    }).status_code == 401
    with TestingSessionLocal() as db:
        user = db.query(User).filter_by(email='suppression_test@example.com').first()
        user.is_active = False
        db.commit()
    assert apply(client, auth_headers, identity, before['rule_fingerprint']).status_code == 403


@pytest.mark.parametrize('body', [
    {}, {'enabled': 'false', 'expected_fingerprint': 'a' * 64},
    {'enabled': 0, 'expected_fingerprint': 'a' * 64},
    {'enabled': False, 'expected_fingerprint': 'a' * 63},
    {'enabled': False, 'expected_fingerprint': 'A' * 64},
    {'enabled': False, 'expected_fingerprint': 'a' * 64, 'duration_hours': 1},
])
def test_request_contract_does_not_coerce_status_or_allow_other_changes(client, auth_headers, body):
    identity, _ = read(client, auth_headers)
    response = client.post(f'/api/v1/suppression-rules/{identity}/reviewed-status', headers=auth_headers, json=body)
    assert response.status_code == 422
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).enabled is True


def test_noop_and_empty_criteria_cannot_be_enabled_but_can_be_paused(client, auth_headers):
    identity, before = read(client, auth_headers)
    assert apply(client, auth_headers, identity, before['rule_fingerprint'], True).status_code == 409
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        rule.cve_id = rule.asset_id = rule.severity = rule.title_contains = None
        db.commit()
    _, empty = read(client, auth_headers)
    paused = apply(client, auth_headers, identity, empty['rule_fingerprint'])
    assert paused.status_code == 200 and paused.json()['rule']['enabled'] is False
    assert apply(client, auth_headers, identity, paused.json()['rule_fingerprint'], True).status_code == 422


def test_fingerprint_binds_values_not_keys_order_or_transient_match_counts():
    snapshot = {'id': 7, 'name': 'Unicode 名 %_ ', 'cve_id': None, 'asset_id': 11, 'severity': 'high',
                'title_contains': '100%_ literal', 'duration_hours': 24, 'enabled': False,
                'created_at': '2026-01-01T00:00:00Z'}
    reordered = dict(reversed(list(snapshot.items())))
    assert suppression_rule_fingerprint(snapshot) == suppression_rule_fingerprint(reordered)
    for key, value in snapshot.items():
        altered = {**snapshot, key: not value if isinstance(value, bool) else str(value) + 'x'}
        assert suppression_rule_fingerprint(altered) != suppression_rule_fingerprint(snapshot)


def test_shared_cross_language_fingerprint_vector():
    vector = json.loads((Path(__file__).parent / 'fixtures' / 'suppression-review-v1.json').read_text())
    assert suppression_rule_fingerprint(vector['rule']) == vector['fingerprint']


@pytest.mark.parametrize('microseconds', [1, 123456, 999999])
def test_significant_creation_microseconds_survive_the_atomic_condition(client, auth_headers, microseconds):
    identity, _ = read(client, auth_headers)
    with TestingSessionLocal() as db:
        db.get(AlertSuppressionRule, identity).created_at = datetime(2026, 1, 1, microsecond=microseconds, tzinfo=UTC)
        db.commit()
    _, before = read(client, auth_headers)
    response = apply(client, auth_headers, identity, before['rule_fingerprint'])
    assert response.status_code == 200 and response.json()['rule']['enabled'] is False


def test_single_microsecond_race_refuses_the_atomic_update(client, auth_headers, monkeypatch):
    identity, _ = read(client, auth_headers)
    with TestingSessionLocal() as db:
        db.get(AlertSuppressionRule, identity).created_at = datetime(2026, 1, 1, microsecond=123456, tzinfo=UTC)
        db.commit()
    _, before = read(client, auth_headers)
    original = AsyncSession.execute
    raced = []

    async def execute(session, statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == 'alert_suppression_rules' and not raced:
            raced.append(True)
            with TestingSessionLocal() as other:
                other.execute(update(AlertSuppressionRule).where(
                    AlertSuppressionRule.id == identity,
                ).values(created_at=datetime(2026, 1, 1, microsecond=123457, tzinfo=UTC)))
                other.commit()
        return await original(session, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, 'execute', execute)
    assert apply(client, auth_headers, identity, before['rule_fingerprint']).status_code == 409
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).enabled is True
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_status').count()


@pytest.mark.asyncio
async def test_reviewed_status_controls_new_matching_alerts_only(client, auth_headers):
    identity, before = read(client, auth_headers)

    async def new_alert_is_snoozed():
        async with AsyncTestingSessionLocal() as db:
            rule = await db.get(AlertSuppressionRule, identity)
            user = await db.get(User, rule.user_id)
            alert = Alert(user_id=user.id, asset_id=before['alerts'][0]['asset_id'],
                          title='RANSOMWARE new match', severity='critical', status='pending')
            db.add(alert)
            await db.flush()
            await _apply_suppression_rules(db, user, alert)
            snoozed = alert.snoozed_until is not None
            await db.rollback()
            return snoozed

    with TestingSessionLocal() as db:
        original_alerts = [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()]
    assert await new_alert_is_snoozed()
    paused = apply(client, auth_headers, identity, before['rule_fingerprint'])
    assert paused.status_code == 200
    assert not await new_alert_is_snoozed()
    enabled = apply(client, auth_headers, identity, paused.json()['rule_fingerprint'], True)
    assert enabled.status_code == 200
    assert await new_alert_is_snoozed()
    with TestingSessionLocal() as db:
        assert [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()] == original_alerts
