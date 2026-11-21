"""Complete, bounded exports preserve applied ownership and literal search scope."""
import pytest
from test_sbom import TestingSessionLocal
from test_sbom import asset_id as asset_id
from test_sbom import auth_headers as auth_headers
from test_sbom import client as client
from test_sbom_component_search import seed

from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent

URL = '/api/v1/sbom/component-search/export'


def test_export_includes_all_pages_and_old_documents_with_provenance(client, auth_headers, asset_id):
    seed(asset_id)
    response = client.get(URL, headers=auth_headers, params={'search': ' openssl '})
    assert response.status_code == 200
    data = response.json()
    assert data['schema'] == 'onealert.recorded-component-evidence.v1' and data['complete'] is True
    assert data['search'] == 'openssl'
    assert data['total'] == len(data['records']) == 25
    assert data['document_count'] == 3 and data['asset_count'] == 2
    assert 'Private' not in str(data)
    ids = [r['component']['id'] for r in data['records']]
    assert len(set(ids)) == 25 and ids == sorted(ids, reverse=True)
    assert all(r['component']['sbom_id'] == r['sbom_id'] for r in data['records'])
    assert all(r['document_source'] and r['document_format'] for r in data['records'])
    assert data['retrieved_at'] and data['limitations']


def test_export_keeps_version_vulnerability_and_exact_asset_filters(client, auth_headers, asset_id):
    seed(asset_id)
    data = client.get(URL, headers=auth_headers, params={
        'search': 'OpenSSL', 'version': ' 3.0 ', 'vulnerable_only': True, 'asset_id': asset_id}).json()
    assert data['scoped_asset_id'] == asset_id and data['scoped_asset_name']
    assert data['total'] == 8 and data['asset_count'] == 1 and data['document_count'] == 2
    assert data['version'] == '3.0' and data['vulnerable_only'] is True
    assert all(r['asset_id'] == asset_id and r['component']['version'] == '3.0'
               and r['component']['has_known_vulnerability'] == 1 for r in data['records'])


def test_literal_wildcards_and_no_matches_remain_distinct_from_error(client, auth_headers, asset_id):
    seed(asset_id)
    data = client.get(URL, headers=auth_headers, params={'search': '100%_'}).json()
    assert data['total'] == 1 and data['records'][0]['component']['name'] == 'Literal 100%_library'
    data = client.get(URL, headers=auth_headers, params={'search': 'not present'}).json()
    assert data['complete'] is True and data['total'] == data['document_count'] == data['asset_count'] == 0
    assert data['records'] == []


def test_export_preserves_raw_recorded_values_without_spreadsheet_rewriting(client, auth_headers, asset_id):
    seed(asset_id)
    with TestingSessionLocal() as db:
        sbom = db.query(SBOM).filter(SBOM.asset_id == asset_id).first()
        db.add(SBOMComponent(sbom_id=sbom.id, name='=formula openssl', version=None,
                             supplier='  +raw', hash_sha256='recorded not verified'))
        db.commit()
    rows = client.get(URL, headers=auth_headers, params={'search': '=formula'}).json()['records']
    assert rows[0]['component']['name'] == '=formula openssl'
    assert rows[0]['component']['version'] is None
    assert rows[0]['component']['supplier'] == '  +raw'
    assert rows[0]['component']['hash_sha256'] == 'recorded not verified'


def test_foreign_or_missing_asset_does_not_fall_back_to_all_assets(client, auth_headers, asset_id):
    seed(asset_id)
    with TestingSessionLocal() as db:
        foreign_id = db.query(Asset).filter(Asset.user_id == 999).first().id
    for identifier in [foreign_id, 2147483647]:
        response = client.get(URL, headers=auth_headers, params={'search': 'openssl', 'asset_id': identifier})
        assert response.status_code == 404
        assert 'records' not in response.json()


def test_over_limit_and_exact_limit(client, auth_headers, asset_id, monkeypatch):
    seed(asset_id)
    monkeypatch.setattr('backend.routers.sbom_component_search.COMPONENT_EXPORT_LIMIT', 24)
    response = client.get(URL, headers=auth_headers, params={'search': 'openssl'})
    assert response.status_code == 422 and 'No partial export' in response.text
    assert 'records' not in response.json()
    monkeypatch.setattr('backend.routers.sbom_component_search.COMPONENT_EXPORT_LIMIT', 25)
    response = client.get(URL, headers=auth_headers, params={'search': 'openssl'})
    assert response.status_code == 200 and response.json()['total'] == 25


@pytest.mark.parametrize('params', [{}, {'search': ' '}, {'search': 'x' * 201},
                                   {'search': 'ok', 'version': 'x' * 201},
                                   {'search': 'ok', 'asset_id': 0}, {'search': 'ok', 'asset_id': 2147483648}])
def test_invalid_scope_is_not_exported(client, auth_headers, asset_id, params):
    assert client.get(URL, headers=auth_headers, params=params).status_code == 422
