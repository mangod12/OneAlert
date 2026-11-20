"""Existing-alert previews use runtime criteria without applying suppression."""
from test_suppression_rules import TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User


def seed():
    with TestingSessionLocal() as db:
        user = db.query(User).first()
        asset = db.query(Asset).filter(Asset.user_id == user.id).first()
        rule = AlertSuppressionRule(user_id=user.id, name='Paused literal criteria', enabled=False,
                                    asset_id=asset.id, cve_id='cve-2026-9000', title_contains='100%_', severity='high')
        foreign = AlertSuppressionRule(user_id=999, name='Foreign private rule', severity='high')
        db.add_all([rule, foreign])
        db.flush()
        for index in range(25):
            db.add(Alert(user_id=user.id, asset_id=asset.id, cve_id='CVE-2026-9000', title=f'Match 100%_ {index}',
                         severity='high', status='pending' if index < 23 else 'resolved'))
        db.add_all([Alert(user_id=user.id, asset_id=asset.id, cve_id='CVE-2026-9000', title='No literal pattern',
                          severity='high', status='pending'),
                    Alert(user_id=999, asset_id=asset.id, cve_id='CVE-2026-9000', title='Private 100%_',
                          severity='high', status='pending')])
        db.commit()
        return rule.id, foreign.id


def test_paused_criteria_preview_pages_owned_active_matches_and_does_not_write(client, auth_headers):
    identity, _ = seed()
    pages = [client.get(f'/api/v1/suppression-rules/{identity}/matching-alerts', headers=auth_headers,
                        params={'page': page}).json() for page in [1, 2, 3]]
    assert all(page['total'] == page['matching_total'] == 23 for page in pages)
    assert [len(page['alerts']) for page in pages] == [10, 10, 3]
    ids = [row['id'] for page in pages for row in page['alerts']]
    assert ids == sorted(set(ids), reverse=True)
    assert pages[0]['criteria_present'] is True and pages[0]['rule']['enabled'] is False
    assert 'Private' not in str(pages)
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).enabled is False
        assert all(db.get(Alert, row_id).status == 'pending' for row_id in ids)


def test_all_status_scope_retains_resolved_and_search_counts_only_filtered_matches(client, auth_headers):
    identity, _ = seed()
    path = f'/api/v1/suppression-rules/{identity}/matching-alerts'
    all_rows = client.get(path, headers=auth_headers, params={'scope': 'all'}).json()
    assert all_rows['total'] == 25 and all_rows['alerts'][0]['status'] == 'resolved'
    data = client.get(path, headers=auth_headers, params={'scope': 'all', 'search': '  100%_ 24  '}).json()
    assert data['total'] == 1 and data['matching_total'] == 25 and data['search'] == '100%_ 24'
    assert data['alerts'][0]['title'] == 'Match 100%_ 24'
    empty = client.get(path, headers=auth_headers, params={'search': 'not present'}).json()
    assert empty['total'] == 0 and empty['matching_total'] == 23 and empty['alerts'] == []


def test_foreign_missing_and_invalid_scope_hidden(client, auth_headers):
    identity, foreign = seed()
    for value in [foreign, 999999]:
        assert client.get(f'/api/v1/suppression-rules/{value}/matching-alerts', headers=auth_headers).status_code == 404
    for params in [{'scope': 'other'}, {'page': 0}, {'size': 101}, {'search': 'x' * 201}]:
        response = client.get(f'/api/v1/suppression-rules/{identity}/matching-alerts',
                              headers=auth_headers, params=params)
        assert response.status_code == 422


def test_legacy_blank_criteria_are_identified_without_repair(client, auth_headers):
    identity, _ = seed()
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        rule.asset_id = rule.cve_id = rule.title_contains = rule.severity = None
        db.commit()
    data = client.get(f'/api/v1/suppression-rules/{identity}/matching-alerts', headers=auth_headers).json()
    assert data['criteria_present'] is False and data['total'] >= 24
    assert data['rule']['enabled'] is False


def test_preview_uses_runtime_unicode_matcher_and_every_set_criterion(client, auth_headers):
    identity, _ = seed()
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        rule.title_contains = 'ä'
        db.add(Alert(user_id=rule.user_id, asset_id=rule.asset_id, title='Gateway Ä check',
                     cve_id='CVE-2026-9000', severity='high', status='acknowledged'))
        db.add(Alert(user_id=rule.user_id, asset_id=rule.asset_id, title='Gateway Ä check',
                     cve_id='CVE-2026-OTHER', severity='high', status='pending'))
        db.add(Alert(user_id=rule.user_id, asset_id=rule.asset_id, title='Gateway Ä check',
                     cve_id='CVE-2026-9000', severity='low', status='pending'))
        db.commit()
    path = f'/api/v1/suppression-rules/{identity}/matching-alerts'
    data = client.get(path, headers=auth_headers).json()
    assert data['total'] == data['matching_total'] == 1
    assert data['alerts'][0]['status'] == 'acknowledged'
    assert 'matching_active_alerts' not in data['rule']
    assert client.get(path, headers=auth_headers, params={'page': 999}).json()['alerts'] == []
