"""Draft previews are read-only, bounded and use the exact runtime criteria matcher."""
import pytest
from test_suppression_rules import TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User


def seed():
    with TestingSessionLocal() as db:
        user = db.query(User).first()
        asset = db.query(Asset).filter(Asset.user_id == user.id).first()
        foreign = Asset(user_id=999, name='Private foreign asset', asset_type='server')
        db.add(foreign)
        for index in range(24):
            db.add(Alert(user_id=user.id, asset_id=asset.id, title=f'Gateway Ä 100%_ {index}',
                         severity='high', cve_id='CVE-2026-9000', status='pending' if index < 23 else 'resolved'))
        db.add(Alert(user_id=999, asset_id=asset.id, title='Private Ä 100%_',
                     severity='high', cve_id='CVE-2026-9000', status='pending'))
        db.commit()
        return asset.id, foreign.id


def counts():
    with TestingSessionLocal() as db:
        return (db.query(AlertSuppressionRule).count(), db.query(AuditLog).count(),
                [(a.id, a.status, a.snoozed_until) for a in db.query(Alert).order_by(Alert.id).all()])


def test_full_active_counts_bounded_examples_unicode_literal_and_no_writes(client, auth_headers):
    asset_id, _ = seed()
    before = counts()
    proposal = {'name': 'Proposed gateway noise', 'asset_id': asset_id, 'severity': 'high',
                'cve_id': 'cve-2026-9000', 'title_contains': 'ä 100%_', 'duration_hours': 12}
    response = client.post('/api/v1/suppression-rules/preview', headers=auth_headers, json=proposal)
    assert response.status_code == 200
    data = response.json()
    assert data['matching_alert_count'] == 23 and data['active_alert_count'] >= 23
    assert len(data['examples']) == data['example_limit'] == 10
    ids = [row['id'] for row in data['examples']]
    assert ids == sorted(set(ids), reverse=True)
    assert 'Private' not in str(data)
    assert all(row['status'] == 'pending' and row['asset_id'] == asset_id for row in data['examples'])
    assert data['proposal'] == {**proposal, 'enabled': True}
    assert counts() == before
    assert client.post('/api/v1/suppression-rules/preview', headers=auth_headers,
                       json=proposal).json()['examples'] == data['examples']
    assert counts() == before


def test_zero_matches_and_defaulted_proposal_are_explicit(client, auth_headers):
    seed()
    data = client.post('/api/v1/suppression-rules/preview', headers=auth_headers,
                       json={'name': 'Nothing now', 'title_contains': 'not present anywhere'}).json()
    assert data['matching_alert_count'] == 0 and data['examples'] == []
    assert data['proposal']['duration_hours'] == 24 and data['proposal']['enabled'] is True
    assert data['proposal']['asset_id'] is None and data['active_alert_count'] > 0


def test_foreign_asset_is_hidden_and_match_all_rejected(client, auth_headers):
    _, foreign = seed()
    before = counts()
    response = client.post('/api/v1/suppression-rules/preview', headers=auth_headers,
                           json={'name': 'Foreign asset', 'asset_id': foreign})
    assert response.status_code == 404
    response = client.post('/api/v1/suppression-rules/preview', headers=auth_headers, json={'name': 'Match everything'})
    assert response.status_code == 422
    assert counts() == before


@pytest.mark.parametrize('updates', [{'duration_hours': 0}, {'duration_hours': 721}, {'duration_hours': 1.5},
                                     {'severity': 'invalid'}, {'name': ''}])
def test_invalid_draft_never_writes(client, auth_headers, updates):
    before = counts()
    response = client.post('/api/v1/suppression-rules/preview', headers=auth_headers,
                           json={'name': 'Draft rule', 'severity': 'high', **updates})
    assert response.status_code == 422
    assert counts() == before
