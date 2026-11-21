"""Asset-group drilldown keeps the applied component criteria and exact owned evidence scope."""
import pytest
from test_sbom_component_search import asset_id as asset_id
from test_sbom_component_search import auth_headers as auth_headers
from test_sbom_component_search import client as client
from test_sbom_component_search import seed


def test_drilldown_retains_filters_counts_and_pages_only_the_selected_owned_asset(client, auth_headers, asset_id):
    seed(asset_id)
    params = {'search': ' openssl ', 'version': ' 3.0 ', 'vulnerable_only': True, 'asset_id': asset_id, 'size': 2}
    pages = [client.get('/api/v1/sbom/component-search', headers=auth_headers,
                        params=dict(params, page=page)).json() for page in [1, 2, 3, 4]]
    assert all(row['scoped_asset_id'] == asset_id and row['scoped_asset_name'] for row in pages)
    assert all(row['asset_count'] == 1 and row['document_count'] == 2 and row['total'] == 8 for row in pages)
    records = [record for page in pages for record in page['records']]
    assert len(records) == 8 and len({record['component']['id'] for record in records}) == 8
    assert all(record['asset_id'] == asset_id and record['component']['version'] == '3.0'
               and record['component']['has_known_vulnerability'] > 0 for record in records)
    assert all(page['search'] == 'openssl' and page['version'] == '3.0' for page in pages)
    assert 'Private' not in str(pages)


def test_missing_or_foreign_assets_are_not_converted_to_an_unscoped_search(client, auth_headers, asset_id):
    from test_sbom import TestingSessionLocal

    from backend.models.asset import Asset
    seed(asset_id)
    with TestingSessionLocal() as db:
        foreign_id = db.query(Asset).filter_by(user_id=999).first().id
    for identity in [foreign_id, 2147483647]:
        response = client.get('/api/v1/sbom/component-search', headers=auth_headers,
                              params={'search': 'openssl', 'asset_id': identity})
        assert response.status_code == 404 and 'Private' not in response.text


@pytest.mark.parametrize('identity', [0, -1, 'invalid', 2147483648])
def test_invalid_asset_scope_is_rejected(client, auth_headers, asset_id, identity):
    response = client.get('/api/v1/sbom/component-search', headers=auth_headers,
                          params={'search': 'openssl', 'asset_id': identity})
    assert response.status_code == 422


def test_valid_owned_asset_with_no_matches_stays_explicitly_scoped(client, auth_headers, asset_id):
    data = client.get('/api/v1/sbom/component-search', headers=auth_headers,
                      params={'search': 'absent', 'asset_id': asset_id}).json()
    assert data['scoped_asset_id'] == asset_id and data['asset_count'] == data['total'] == data['document_count'] == 0
    assert data['records'] == []
