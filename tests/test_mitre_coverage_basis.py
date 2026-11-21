"""Coverage association provenance is not verified detection efficacy."""
from sqlalchemy import select
from test_mitre_coverage import _register_and_login, _TestingSessionLocal
from test_mitre_coverage import client as client

from backend.models.case import Case
from backend.models.detection_rule import DetectionRule
from backend.models.user import User
from backend.services.mitre.attack_data import TECHNIQUES

PATH = '/api/v1/mitre/coverage-basis'


def test_owner_exact_associations_duplicates_and_current_rule_states(client):
    owner = _register_and_login(client, 'basis-owner@example.com')
    _register_and_login(client, 'basis-other@example.com')
    with _TestingSessionLocal() as db:
        user = db.execute(select(User).where(User.email == 'basis-owner@example.com')).scalar_one()
        other = db.execute(select(User).where(User.email == 'basis-other@example.com')).scalar_one()
        db.add_all([
            Case(user_id=user.id, title='Closed mapping', status='closed',
                 mitre_techniques=['T1190', {'id': 'T1190'}, 'T1110', 'T1021.001', 'T9999', None, 12]),
            Case(user_id=user.id, title='Second case', status='open', mitre_techniques=[{'id': 'T1190'}]),
            Case(user_id=other.id, title='Private', mitre_techniques=['T1110']),
            Case(user_id=user.id, title='Malformed', mitre_techniques={'id': 'T1078'}),
        ])
        for uid, enabled, techniques in [
            (user.id, True, ['T1190', 'T1190', {'id': 'T1190'}, 'T1078']),
            (user.id, False, ['T1110', 'T1133']), (other.id, True, ['T1110', 'T1133']),
        ]:
            db.add(DetectionRule(user_id=uid, name='Rule', rule_type='sigma', rule_content='test',
                                  enabled=enabled, mitre_techniques=techniques))
        db.commit()
    response = client.get(PATH, headers=owner)
    assert response.status_code == 200
    data = response.json()
    rows = {row['technique_id']: row for row in data['records']}
    assert len(rows) == data['total_techniques'] == len(TECHNIQUES)
    assert list(rows) == sorted(rows)
    assert rows['T1190']['case_count'] == 2 and rows['T1190']['enabled_rule_count'] == 1
    assert rows['T1190']['basis'] == 'both'
    assert rows['T1110']['basis'] == 'case_only' and rows['T1110']['enabled_rule_count'] == 0
    assert rows['T1110']['disabled_rule_count'] == 1
    assert rows['T1078']['basis'] == 'rule_only' and rows['T1078']['case_count'] == 0
    assert rows['T1133']['basis'] == 'unmapped' and rows['T1133']['disabled_rule_count'] == 1
    assert rows['T1021.001']['case_count'] == 1 and rows['T1021']['case_count'] == 0
    assert sum(data['counts'].values()) == len(TECHNIQUES)
    assert data['counts'] == {'both': 1, 'case_only': 2, 'rule_only': 1, 'unmapped': len(TECHNIQUES) - 4}
    summary = client.get('/api/v1/mitre/coverage', headers=owner).json()['data']
    assert set(summary['covered_ids']) == {tid for tid, row in rows.items() if row['basis'] != 'unmapped'}
    assert all(set(row) == {'technique_id', 'name', 'tactics', 'case_count', 'enabled_rule_count',
                            'disabled_rule_count', 'unknown_rule_state_count', 'basis'} for row in rows.values())
    assert 'Private' not in str(data)


def test_no_associations_is_catalog_unmapped_not_verified_protection(client):
    headers = _register_and_login(client, 'basis-empty@example.com')
    data = client.get(PATH, headers=headers).json()
    assert data['counts']['unmapped'] == len(TECHNIQUES)
    assert all(row['case_count'] == row['enabled_rule_count'] == row['disabled_rule_count'] == 0
               for row in data['records'])
    assert 'subset' in data['catalog_scope'] and data['retrieved_at']
    client.cookies.clear()
    assert client.get(PATH).status_code == 401
