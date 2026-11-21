"""Risk explanations stay identical to current inventory scoring and inside the owner."""
import pytest
from test_assets_risk import _make_alert, _make_asset, _register_and_login, _user_id
from test_assets_risk import client as client


def seed(client, criticality='high'):
    owner = _register_and_login(client, 'risk-evidence-owner@example.com')
    other = _register_and_login(client, 'risk-evidence-other@example.com')
    uid = _user_id(client, owner)
    foreign_uid = _user_id(client, other)
    asset = _make_asset(uid, 'Plant gateway', criticality)
    other_asset = _make_asset(uid, 'Other asset')
    for index in range(12):
        _make_alert(uid, asset, f'Contributing alert {index}', 'critical' if index == 0 else 'high',
                    ['pending', 'sent', 'acknowledged'][index % 3])
    _make_alert(uid, asset, 'Earlier closed alert', 'critical', 'resolved')
    _make_alert(uid, asset, 'Failed notification', 'critical', 'failed')
    _make_alert(foreign_uid, asset, 'Private foreign alert', 'critical')
    _make_alert(uid, other_asset, 'Different asset', 'critical')
    return owner, other, asset


def test_full_summary_and_paginated_contributors_match_inventory_without_foreign_data(client):
    owner, other, asset = seed(client)
    path = f'/api/v1/assets/{asset}/risk-evidence'
    first = client.get(path, headers=owner).json()
    second = client.get(path, headers=owner, params={'page': 2}).json()
    assert first['total'] == 12
    assert first['base_points'] == 65 and first['multiplier'] == 1.5
    assert first['rounded_points'] == 98 and first['score'] == 98 and first['level'] == 'critical'
    assert first['status_counts'] == {'pending': 4, 'sent': 4, 'acknowledged': 4, 'resolved': 1, 'failed': 1}
    assert first['severity_breakdown'] == [
        {'severity': 'critical', 'count': 1, 'weight': 10, 'base_points': 10},
        {'severity': 'high', 'count': 11, 'weight': 5, 'base_points': 55},
    ]
    rows = first['records'] + second['records']
    assert len(first['records']) == 10 and len(second['records']) == 2
    assert len({row['id'] for row in rows}) == 12
    assert rows[0]['severity'] == 'critical'
    assert [row['id'] for row in rows[1:]] == sorted([row['id'] for row in rows[1:]], reverse=True)
    assert all(row['status'] in first['included_statuses'] for row in rows)
    assert 'Private foreign alert' not in str(first) + str(second)
    assert 'Different asset' not in str(first) + str(second)
    detail = client.get(f'/api/v1/assets/{asset}', headers=owner).json()
    assert (detail['risk_score'], detail['risk_level']) == (first['score'], first['level'])
    assert client.get(path, headers=other).status_code == 404
    assert client.get('/api/v1/assets/999999/risk-evidence', headers=owner).status_code == 404
    client.cookies.clear()
    assert client.get(path).status_code in (401, 403)


@pytest.mark.parametrize('criticality,severity,count,base,rounded,score', [
    ('low', 'low', 1, 1, 0, 0), ('low', 'info', 3, 3, 2, 2),
    ('high', 'high', 3, 15, 22, 22), ('critical', 'critical', 12, 120, 240, 100),
    ('unexpected', 'HIGH', 1, 5, 5, 5),
])
def test_rounding_cap_unknown_severity_and_criticality_follow_current_score(
    client, criticality, severity, count, base, rounded, score,
):
    owner = _register_and_login(client, 'risk-round@example.com')
    uid = _user_id(client, owner)
    asset = _make_asset(uid, 'Rounding example', criticality)
    for index in range(count):
        _make_alert(uid, asset, f'Example {index}', severity)
    path = f'/api/v1/assets/{asset}'
    data = client.get(path + '/risk-evidence', headers=owner).json()
    assert (data['base_points'], data['rounded_points'], data['score']) == (base, rounded, score)
    assert client.get(path, headers=owner).json()['risk_score'] == score


def test_zero_and_changed_statuses_refresh_without_mutation(client):
    owner = _register_and_login(client, 'risk-empty@example.com')
    asset = _make_asset(_user_id(client, owner), 'No alerts')
    path = f'/api/v1/assets/{asset}/risk-evidence'
    data = client.get(path, headers=owner).json()
    assert data['score'] == data['base_points'] == data['total'] == 0
    assert data['severity_breakdown'] == data['records'] == []
    _make_alert(_user_id(client, owner), asset, 'New acknowledged alert', 'high', 'acknowledged')
    refreshed = client.get(path, headers=owner).json()
    assert refreshed['score'] == 5 and refreshed['total'] == 1
    assert client.get(path, headers=owner, params={'page': 999}).json()['records'] == []
    assert client.get(path, headers=owner).json()['status_counts'] == refreshed['status_counts']


@pytest.mark.parametrize('params', [{'page': 0}, {'size': 0}, {'size': 101}])
def test_rejects_invalid_pagination(client, params):
    owner = _register_and_login(client, 'risk-invalid@example.com')
    asset = _make_asset(_user_id(client, owner), 'Example')
    assert client.get(f'/api/v1/assets/{asset}/risk-evidence', headers=owner, params=params).status_code == 422
