"""Complete reviewed edits preserve identity/status and fail closed on concurrent changes."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Update
from test_suppression_rules import AsyncTestingSessionLocal, TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User
from backend.services.alert_checker import _apply_suppression_rules
from backend.services.suppression_review import suppression_rule_fingerprint

FIELDS = ('name', 'cve_id', 'asset_id', 'severity', 'title_contains', 'duration_hours')


def read(client, headers):
    identity = client.get('/api/v1/suppression-rules/', headers=headers).json()[0]['id']
    response = client.get(f'/api/v1/suppression-rules/{identity}/edit-review', headers=headers)
    assert response.status_code == 200
    raw = response.json()
    assert raw['rule_fingerprint'] == suppression_rule_fingerprint(raw['rule'])
    return identity, raw


def body(raw, **changes):
    return dict(expected_fingerprint=raw['rule_fingerprint'],
                proposal={**{key: raw['rule'][key] for key in FIELDS}, **changes})


def post(client, headers, identity, payload, route='reviewed-edit'):
    return client.post(f'/api/v1/suppression-rules/{identity}/{route}',
                       headers={**headers, 'Content-Type': 'application/json'}, content=json.dumps(payload))


def alert_state():
    with TestingSessionLocal() as db:
        return [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).order_by(Alert.id)]


@pytest.mark.parametrize('enabled', [True, False])
def test_review_full_edit_preserves_status_identity_literal_values_and_existing_alerts(client, auth_headers, enabled):
    with TestingSessionLocal() as db:
        db.query(AlertSuppressionRule).first().enabled = enabled
        db.commit()
    identity, raw = read(client, auth_headers)
    original_alerts = alert_state()
    payload = body(raw, name='Reviewed 名', title_contains='  Ä%_  ', cve_id='cve-2026-7777', duration_hours=12)
    preview = post(client, auth_headers, identity, payload, 'edit-preview')
    assert preview.status_code == 200
    data = preview.json()
    expected = {**raw['rule'], **payload['proposal']}
    assert data['rule'] == raw['rule'] and data['proposed_rule'] == expected
    assert data['proposed_rule_fingerprint'] == suppression_rule_fingerprint(expected)
    with TestingSessionLocal() as db:
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()
        assert db.get(AlertSuppressionRule, identity).name == raw['rule']['name']
    response = post(client, auth_headers, identity, payload)
    assert response.status_code == 200
    assert response.json() == dict(conditional_update_applied=True, reviewed_fingerprint=raw['rule_fingerprint'],
                                   rule=expected, rule_fingerprint=suppression_rule_fingerprint(expected))
    assert alert_state() == original_alerts
    assert post(client, auth_headers, identity, payload).status_code == 409
    with TestingSessionLocal() as db:
        logs = db.query(AuditLog).filter_by(action='reviewed_suppression_edit').all()
        assert len(logs) == 1 and logs[0].target_id == identity
        assert 'Ä' not in logs[0].detail and 'cve-2026' not in logs[0].detail


def test_delta_counts_are_complete_owned_active_unicode_literal_and_bounded_examples(client, auth_headers):
    identity, raw = read(client, auth_headers)
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        rule.title_contains = 'Ä%_'
        rule.enabled = False
        asset_id = db.query(Alert).first().asset_id
        for index in range(15):
            db.add(Alert(user_id=rule.user_id, asset_id=asset_id, title='Ä%_ retained', severity='critical',
                         status=('pending', 'sent', 'acknowledged')[index % 3]))
        db.add_all([
            Alert(user_id=rule.user_id, asset_id=asset_id, title='ä%_ removed', severity='high', status='sent'),
            Alert(user_id=rule.user_id, asset_id=asset_id, title='New critical added',
                  severity='critical', status='acknowledged'),
            Alert(user_id=rule.user_id, asset_id=asset_id, title='Ä%_ resolved',
                  severity='critical', status='resolved'),
            Alert(user_id=999, asset_id=asset_id, title='Ä%_ foreign', severity='critical', status='pending'),
        ])
        db.commit()
    identity, raw = read(client, auth_headers)
    before = alert_state()
    payload = body(raw, title_contains=None, severity='critical')
    response = post(client, auth_headers, identity, payload, 'edit-preview')
    assert response.status_code == 200
    data = response.json()
    assert data['counts'] == dict(retained=15, removed=1, added=2)
    assert data['before_count'] == 16 and data['after_count'] == 17
    assert data['active_alert_count'] == 18
    assert data['scope'] == 'active' and data['active_alert_limit'] == 50000 and data['example_limit'] == 10
    assert len(data['examples']['retained']) == 10
    for rows in data['examples'].values():
        assert [row['id'] for row in rows] == sorted([row['id'] for row in rows], reverse=True)
        assert all('resolved' not in row['title'] and 'foreign' not in row['title'] for row in rows)
        assert all(set(row) == {
            'id', 'asset_id', 'title', 'cve_id', 'severity', 'status', 'created_at',
        } for row in rows)
    assert alert_state() == before
    with TestingSessionLocal() as db:
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()


@pytest.mark.parametrize('field,value', [
    ('name', 'Concurrent name'), ('cve_id', 'CVE-2026-9999'), ('asset_id', 999), ('severity', 'high'),
    ('title_contains', 'Other criterion'), ('duration_hours', 1), ('enabled', False),
    ('created_at', datetime(2026, 1, 1, microsecond=123456, tzinfo=UTC)),
])
def test_stale_preview_and_edit_refuse_every_revised_saved_value(client, auth_headers, field, value):
    identity, raw = read(client, auth_headers)
    with TestingSessionLocal() as db:
        setattr(db.get(AlertSuppressionRule, identity), field, value)
        db.commit()
    for route in ('edit-preview', 'reviewed-edit'):
        assert post(client, auth_headers, identity, body(raw, name='New intended name'), route).status_code == 409
    with TestingSessionLocal() as db:
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()


@pytest.mark.parametrize('field,value', [
    ('name', 'Concurrent name'), ('cve_id', 'CVE-2026-9999'), ('asset_id', 999), ('severity', 'high'),
    ('title_contains', 'Other criterion'), ('duration_hours', 1), ('enabled', False), ('user_id', 999),
    ('created_at', datetime(2026, 1, 1, microsecond=123457, tzinfo=UTC)),
])
def test_atomic_condition_rechecks_after_read_before_update(client, auth_headers, monkeypatch, field, value):
    identity, raw = read(client, auth_headers)
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
    assert post(client, auth_headers, identity, body(raw, name='New intended name')).status_code == 409
    assert raced
    with TestingSessionLocal() as db:
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()
        assert db.get(AlertSuppressionRule, identity).name != 'New intended name'


@pytest.mark.parametrize('changes', [
    {'enabled': False}, {'user_id': 999}, {'id': 999}, {'created_at': '2026-01-01T00:00:00Z'},
    {'name': ''}, {'name': '   '}, {'name': None}, {'duration_hours': True}, {'duration_hours': '12'},
    {'duration_hours': 1.2}, {'duration_hours': 0}, {'duration_hours': 721}, {'duration_hours': None},
    {'asset_id': True}, {'asset_id': 0}, {'asset_id': '1'}, {'severity': 'HIGH'},
    {'title_contains': 'x' * 16385}, {'title_contains': '\ud800'}, {'name': '\udfff'},
    {'title_contains': None},
])
def test_strict_complete_proposals_reject_unsupported_immutable_invalid_or_empty_changes(client, auth_headers, changes):
    identity, raw = read(client, auth_headers)
    for route in ('edit-preview', 'reviewed-edit'):
        assert post(client, auth_headers, identity, body(raw, **changes), route).status_code == 422
    with TestingSessionLocal() as db:
        assert suppression_rule_fingerprint(raw['rule']) == raw['rule_fingerprint']
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()


def test_missing_fields_unknown_envelope_bad_hash_noop_and_asset_ownership(client, auth_headers):
    identity, raw = read(client, auth_headers)
    missing = body(raw, name='New name')
    del missing['proposal']['severity']
    for payload in (missing, {**body(raw, name='New name'), 'enabled': False},
                    {**body(raw, name='New name'), 'expected_fingerprint': 'A' * 64}):
        assert post(client, auth_headers, identity, payload).status_code == 422
    assert post(client, auth_headers, identity, body(raw)).status_code == 409
    with TestingSessionLocal() as db:
        asset = Asset(user_id=999, name='Foreign private asset', asset_type='plc')
        db.add(asset)
        db.commit()
        foreign_id = asset.id
    for asset_id in (foreign_id, 99999):
        for route in ('edit-preview', 'reviewed-edit'):
            response = post(client, auth_headers, identity, body(raw, asset_id=asset_id), route)
            assert response.status_code == 404 and 'private' not in response.text


def test_owner_active_auth_scoping_for_all_three_routes(client, auth_headers):
    identity, raw = read(client, auth_headers)
    with TestingSessionLocal() as db:
        foreign = AlertSuppressionRule(user_id=999, name='Foreign private rule', title_contains='private')
        db.add(foreign)
        db.commit()
        foreign_id = foreign.id
    for target in (foreign_id, 99999):
        assert client.get(f'/api/v1/suppression-rules/{target}/edit-review', headers=auth_headers).status_code == 404
        for route in ('edit-preview', 'reviewed-edit'):
            response = post(client, auth_headers, target, body(raw, name='New name'), route)
            assert response.status_code == 404 and 'private' not in response.text
    client.cookies.clear()
    assert client.get(f'/api/v1/suppression-rules/{identity}/edit-review').status_code == 401
    for route in ('edit-preview', 'reviewed-edit'):
        assert post(client, {}, identity, body(raw, name='New name'), route).status_code == 401
    with TestingSessionLocal() as db:
        db.query(User).filter_by(email='suppression_test@example.com').first().is_active = False
        db.commit()
    assert client.get(f'/api/v1/suppression-rules/{identity}/edit-review', headers=auth_headers).status_code == 403
    for route in ('edit-preview', 'reviewed-edit'):
        assert post(client, auth_headers, identity, body(raw, name='New name'), route).status_code == 403


def test_empty_legacy_rule_can_be_repaired_without_match_all_before_claim(client, auth_headers):
    with TestingSessionLocal() as db:
        rule = db.query(AlertSuppressionRule).first()
        rule.title_contains = None
        db.commit()
    identity, raw = read(client, auth_headers)
    payload = body(raw, severity='critical')
    preview = post(client, auth_headers, identity, payload, 'edit-preview').json()
    assert preview['before_count'] == 0 and preview['counts'] == dict(retained=0, removed=0, added=1)
    assert post(client, auth_headers, identity, payload).status_code == 200


def test_preview_refuses_over_bound_without_write_or_partial_counts(client, auth_headers, monkeypatch):
    import backend.routers.suppression_edit as module
    identity, raw = read(client, auth_headers)
    monkeypatch.setattr(module, '_ACTIVE_ALERT_LIMIT', 0)
    response = post(client, auth_headers, identity, body(raw, name='New name'), 'edit-preview')
    assert response.status_code == 422 and 'No partial counts' in response.text
    assert 'counts' not in response.json()
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).name == raw['rule']['name']
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()


def test_asset_owner_is_rechecked_in_same_atomic_update(client, auth_headers, monkeypatch):
    identity, raw = read(client, auth_headers)
    with TestingSessionLocal() as db:
        asset_id = db.query(Alert).first().asset_id
    original = AsyncSession.execute
    raced = []

    async def execute(session, statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == 'alert_suppression_rules' and not raced:
            raced.append(True)
            with TestingSessionLocal() as other:
                other.execute(update(Asset).where(Asset.id == asset_id).values(user_id=999))
                other.commit()
        return await original(session, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, 'execute', execute)
    assert post(client, auth_headers, identity, body(raw, asset_id=asset_id)).status_code == 409
    assert raced
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).asset_id is None
        assert not db.query(AuditLog).filter_by(action='reviewed_suppression_edit').count()


@pytest.mark.parametrize('microseconds', [0, 1, 123456, 999999])
def test_exact_creation_time_condition_preserves_significant_microseconds(client, auth_headers, microseconds):
    with TestingSessionLocal() as db:
        db.query(AlertSuppressionRule).first().created_at = datetime(2026, 1, 1, microsecond=microseconds, tzinfo=UTC)
        db.commit()
    identity, raw = read(client, auth_headers)
    assert post(client, auth_headers, identity, body(raw, name='Edited name')).status_code == 200


@pytest.mark.asyncio
async def test_saved_criteria_edit_changes_new_alert_matching_only(client, auth_headers):
    identity, raw = read(client, auth_headers)
    before = alert_state()

    async def snoozes(title):
        async with AsyncTestingSessionLocal() as db:
            rule = await db.get(AlertSuppressionRule, identity)
            asset_id = (await db.execute(select_asset())).scalar_one()
            alert = Alert(user_id=rule.user_id, asset_id=asset_id, title=title, severity='critical', status='pending')
            db.add(alert)
            await db.flush()
            await _apply_suppression_rules(db, await db.get(User, rule.user_id), alert)
            result = alert.snoozed_until is not None
            await db.rollback()
            return result

    def select_asset():
        from sqlalchemy import select
        return select(Asset.id).limit(1)

    assert await snoozes('Ransomware old criterion') and not await snoozes('New scanner criterion')
    assert post(client, auth_headers, identity, body(raw, title_contains='scanner')).status_code == 200
    assert not await snoozes('Ransomware old criterion') and await snoozes('New scanner criterion')
    assert alert_state() == before
