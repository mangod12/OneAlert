"""Recorded version groups summarize owned historical matching evidence without semver claims."""
import pytest
from test_sbom_component_search import asset_id as asset_id
from test_sbom_component_search import auth_headers as auth_headers
from test_sbom_component_search import client as client
from test_sbom_component_search import seed


def read(client, headers, **params):
    response = client.get('/api/v1/sbom/component-search/versions', headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_exact_version_groups_deduplicate_assets_and_documents_before_counting(client, auth_headers, asset_id):
    seed(asset_id)
    data = read(client, auth_headers, search=' openssl ')
    assert data['total'] == 2 and data['search'] == 'openssl'
    assert [row['version'] for row in data['versions']] == ['3.0', '3.0.1']
    assert [row['matching_rows'] for row in data['versions']] == [12, 13]
    assert all(row['asset_count'] == 2 and row['document_count'] == 3 for row in data['versions'])
    assert data['versions'][0]['rows_with_recorded_vulnerabilities'] == 12
    assert data['versions'][1]['rows_with_recorded_vulnerabilities'] == 0
    assert 'Private' not in str(data)


def test_applied_filters_narrow_groups_and_paging_is_stable(client, auth_headers, asset_id):
    seed(asset_id)
    first = read(client, auth_headers, search='openssl', size=1)
    second = read(client, auth_headers, search='openssl', size=1, page=2)
    assert first['total'] == second['total'] == 2
    assert first['versions'][0]['version'] == '3.0' and second['versions'][0]['version'] == '3.0.1'
    filtered = read(client, auth_headers, search='openssl', version=' 3.0 ', vulnerable_only=True)
    assert filtered['total'] == 1 and filtered['version'] == '3.0'
    assert filtered['versions'][0] == first['versions'][0]
    assert read(client, auth_headers, search='openssl', page=99)['versions'] == []


def test_missing_and_empty_versions_share_group_but_whitespace_is_preserved(client, auth_headers, asset_id):
    from test_sbom import TestingSessionLocal

    from backend.models.asset import Asset
    from backend.models.sbom import SBOM, SBOMComponent
    with TestingSessionLocal() as db:
        owner = db.get(Asset, asset_id).user_id
        document = SBOM(user_id=owner, asset_id=asset_id, format='SPDX')
        db.add(document)
        db.flush()
        for version in [None, '', ' ', ' 1.0 ', '1.0']:
            db.add(SBOMComponent(sbom_id=document.id, name='Version group', version=version))
        db.commit()
    data = read(client, auth_headers, search='Version group')
    assert data['total'] == 4
    missing = next(row for row in data['versions'] if row['version'] is None)
    assert missing['matching_rows'] == 2 and missing['asset_count'] == missing['document_count'] == 1
    assert {row['version'] for row in data['versions']} == {None, ' ', ' 1.0 ', '1.0'}


@pytest.mark.parametrize('term,total', [('100%_', 1), ('Private', 0), ('absent', 0), ('cpe:openssl', 2)])
def test_literal_search_and_empty_owned_results(client, auth_headers, asset_id, term, total):
    seed(asset_id)
    data = read(client, auth_headers, search=term)
    assert data['total'] == total
    if term == '100%_':
        assert data['versions'][0]['version'] is None


@pytest.mark.parametrize('params', [{}, {'search': ' '}, {'search': 'ok', 'page': 0},
                                   {'search': 'ok', 'size': 101}, {'search': 'x' * 201},
                                   {'search': 'ok', 'version': 'x' * 201}])
def test_invalid_version_group_scope_rejected(client, auth_headers, asset_id, params):
    assert client.get('/api/v1/sbom/component-search/versions', headers=auth_headers, params=params).status_code == 422
