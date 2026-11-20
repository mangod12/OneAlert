"""Malformed rule updates and legacy empty rules cannot silently suppress everything."""
import pytest
from sqlalchemy import select
from test_suppression_rules import AsyncTestingSessionLocal, TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.audit_log import AuditLog
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User
from backend.services.alert_checker import _apply_suppression_rules


@pytest.mark.parametrize('field', ['name', 'duration_hours', 'enabled'])
def test_null_required_update_returns_422_and_leaves_rule_unchanged(client, auth_headers, field):
    before = client.get('/api/v1/suppression-rules/', headers=auth_headers).json()[0]
    response = client.patch(f'/api/v1/suppression-rules/{before["id"]}', headers=auth_headers, json={field: None})
    assert response.status_code == 422
    assert client.get('/api/v1/suppression-rules/', headers=auth_headers).json()[0] == before
    response = client.patch(f'/api/v1/suppression-rules/{before["id"]}', headers=auth_headers, json={'enabled': False})
    assert response.status_code == 200 and response.json()['enabled'] is False


def test_nullable_criteria_can_still_be_cleared_while_another_criterion_remains(client, auth_headers):
    before = client.get('/api/v1/suppression-rules/', headers=auth_headers).json()[0]
    response = client.patch(f'/api/v1/suppression-rules/{before["id"]}', headers=auth_headers,
                            json={'cve_id': None, 'asset_id': None, 'severity': None})
    assert response.status_code == 200 and response.json()['title_contains'] == before['title_contains']


@pytest.mark.asyncio
async def test_empty_legacy_rule_is_skipped_and_valid_rules_still_run(client):
    with TestingSessionLocal() as db:
        user = db.query(User).first()
        user_id = user.id
        asset_id = db.query(Alert).filter(Alert.user_id == user_id).first().asset_id
        db.query(AlertSuppressionRule).delete()
        db.add(AlertSuppressionRule(user_id=user_id, name='Legacy empty', enabled=True, duration_hours=720))
        db.add(AlertSuppressionRule(user_id=user_id, name='Scoped scanner', enabled=True,
                                    title_contains='scanner', duration_hours=24))
        db.commit()
    async with AsyncTestingSessionLocal() as db:
        user = await db.get(User, user_id)
        for title, expected in [('Critical unrelated finding', False), ('Known scanner check', True)]:
            alert = Alert(user_id=user_id, asset_id=asset_id, title=title, severity='critical', status='pending')
            db.add(alert)
            await db.flush()
            await _apply_suppression_rules(db, user, alert)
            assert (alert.snoozed_until is not None) is expected
            audit = (await db.execute(select(AuditLog).where(AuditLog.target_id == alert.id,
                                                             AuditLog.action == 'alert_suppressed'))).scalars().all()
            assert len(audit) == int(expected)
            if audit:
                assert 'Scoped scanner' in audit[0].detail
        await db.rollback()
