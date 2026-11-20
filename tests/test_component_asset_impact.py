"""Matching saved component rows group by owned assets without inferring current installation."""
import pytest
from test_sbom_component_search import asset_id as asset_id
from test_sbom_component_search import auth_headers as auth_headers
from test_sbom_component_search import client as client
from test_sbom_component_search import seed


def read(client, auth_headers, **params):
    response = client.get('/api/v1/sbom/component-search/assets', headers=auth_headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_owned_assets_deduplicate_documents_and_components_and_prioritize_recorded_rows(client, auth_headers, asset_id):
    seed(asset_id)
    result = read(client, auth_headers, search=' openssl ')
    assert result['total'] == 2 and len(result['assets']) == 2 and result['search'] == 'openssl'
    assert 'Private' not in str(result)
    rows = result['assets']
    assert sum(row['matching_rows'] for row in rows) == 25
    assert sum(row['document_count'] for row in rows) == 3
    assert sum(row['rows_with_recorded_vulnerabilities'] for row in rows) == 12
    assert all(row['recorded_version_count'] == 2 and row['missing_version_rows'] == 0 for row in rows)
    assert rows[0]['rows_with_recorded_vulnerabilities'] >= rows[1]['rows_with_recorded_vulnerabilities']
    assert rows[0]['asset_id'] == asset_id
    assert all(row['newest_matching_document_at'] for row in rows)


def test_exact_version_and_vulnerability_filter_applied_before_asset_counts(client, auth_headers, asset_id):
    seed(asset_id)
    result = read(client, auth_headers, search='OpenSSL', version=' 3.0 ', vulnerable_only=True, size=1)
    second = read(client, auth_headers, search='OpenSSL', version='3.0', vulnerable_only=True, page=2, size=1)
    assert result['total'] == second['total'] == 2 and result['version'] == '3.0'
    rows = result['assets'] + second['assets']
    assert len({row['asset_id'] for row in rows}) == 2
    assert sum(row['matching_rows'] for row in rows) == 12
    assert all(row['recorded_version_count'] == 1 for row in rows)
    assert all(row['matching_rows'] == row['rows_with_recorded_vulnerabilities'] for row in rows)
    assert read(client, auth_headers, search='OpenSSL', page=99)['assets'] == []


@pytest.mark.parametrize('term,total', [('100%_', 1), ('pkg:generic/openssl', 2), ('missing', 0),
                                       ('Private', 0), ('Saved supplier', 2), ('cpe:openssl', 2)])
def test_literal_fields_missing_versions_and_absence(client, auth_headers, asset_id, term, total):
    seed(asset_id)
    result = read(client, auth_headers, search=term)
    assert result['total'] == total
    if term == '100%_':
        assert result['assets'][0]['missing_version_rows'] == 1
        assert result['assets'][0]['recorded_version_count'] == 0


@pytest.mark.parametrize('params', [{}, {'search': ''}, {'search': '  '}, {'search': 'x' * 201},
                                   {'search': 'ok', 'page': 0}, {'search': 'ok', 'size': 101}])
def test_malformed_scope_rejected(client, auth_headers, asset_id, params):
    assert client.get('/api/v1/sbom/component-search/assets', headers=auth_headers, params=params).status_code == 422


def test_tied_groups_have_stable_id_order_and_blank_versions_are_missing(client, auth_headers, asset_id):
    from test_sbom import TestingSessionLocal

    from backend.models.asset import Asset
    from backend.models.sbom import SBOM, SBOMComponent
    with TestingSessionLocal() as db:
        owner = db.get(Asset, asset_id).user_id
        for name in ['Zulu asset', 'Alpha asset']:
            row = Asset(user_id=owner, name=name, asset_type='server')
            db.add(row)
            db.flush()
            doc = SBOM(user_id=owner, asset_id=row.id, format='SPDX')
            db.add(doc)
            db.flush()
            db.add(SBOMComponent(sbom_id=doc.id, name='Tie evidence', version=''))
        db.commit()
    first = read(client, auth_headers, search='Tie evidence', size=1)['assets'][0]
    second = read(client, auth_headers, search='Tie evidence', size=1, page=2)['assets'][0]
    assert first['asset_id'] < second['asset_id'] and first['asset_name'] == 'Zulu asset'
    assert first['recorded_version_count'] == 0 and first['missing_version_rows'] == 1
    assert read(client, auth_headers, search='Tie evidence', size=1)['assets'][0] == first
