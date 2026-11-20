"""Server-paged exact SBOM evidence keeps search, gap and owner boundaries."""
import pytest
from test_sbom import TestingSessionLocal
from test_sbom import asset_id as asset_id
from test_sbom import auth_headers as auth_headers
from test_sbom import client as client

from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent


def seed(asset_id):
    with TestingSessionLocal() as db:
        owner = db.get(Asset, asset_id).user_id
        sbom = SBOM(asset_id=asset_id, user_id=owner, format='SPDX', component_count=23)
        other = SBOM(asset_id=asset_id, user_id=999, format='SPDX', component_count=1)
        db.add_all([sbom, other])
        db.flush()
        for index in range(1, 24):
            db.add(SBOMComponent(sbom_id=sbom.id, name='Tie component' if index < 23 else 'Literal 100%_evidence',
                version=None if index % 2 else '4.2', supplier=' ' if index % 2 else 'Vendor',
                license=None if index % 2 else 'MIT', purl=None, cpe=None if index % 2 else 'cpe:record',
                hash_sha256=None if index % 2 else 'a' * 64, has_known_vulnerability=1 if index % 2 else 0))
        db.add(SBOMComponent(sbom_id=other.id, name='Foreign private component', has_known_vulnerability=99))
        db.commit()
        return sbom.id, other.id


def test_pages_are_stable_complete_and_read_only(client, auth_headers, asset_id):
    identity, _ = seed(asset_id)
    path = f'/api/v1/sbom/{identity}/component-evidence'
    pages = [client.get(path, headers=auth_headers, params={'page': page}).json() for page in (1, 2, 3)]
    rows = [row for page in pages for row in page['components']]
    assert [len(page['components']) for page in pages] == [10, 10, 3]
    assert len({row['id'] for row in rows}) == 23
    assert all(row['sbom_id'] == identity for row in rows)
    assert all(page['total'] == page['document_total'] == 23 for page in pages)
    assert pages[0]['components'] == client.get(path, headers=auth_headers).json()['components']
    assert 'Foreign private component' not in str(pages)
    assert len(client.get(f'/api/v1/sbom/{identity}/components', headers=auth_headers).json()) == 23


@pytest.mark.parametrize('gap', ['version', 'supplier', 'license', 'identifiers', 'hash'])
def test_gap_and_vulnerability_filters_apply_before_pagination(client, auth_headers, asset_id, gap):
    identity, _ = seed(asset_id)
    data = client.get(f'/api/v1/sbom/{identity}/component-evidence', headers=auth_headers,
                      params={'gap': gap, 'vulnerable_only': True, 'page': 2, 'size': 10}).json()
    assert data['total'] == 12 and data['document_total'] == 23
    assert len(data['components']) == 2 and all(row['has_known_vulnerability'] == 1 for row in data['components'])
    assert data['gap'] == gap and data['vulnerable_only'] is True


def test_literal_search_and_empty_results(client, auth_headers, asset_id):
    identity, _ = seed(asset_id)
    path = f'/api/v1/sbom/{identity}/component-evidence'
    data = client.get(path, headers=auth_headers, params={'search': '  100%_  '}).json()
    assert data['total'] == 1 and data['search'] == '100%_'
    assert data['components'][0]['name'] == 'Literal 100%_evidence'
    assert client.get(path, headers=auth_headers, params={'search': 'not recorded here'}).json()['components'] == []
    assert client.get(path, headers=auth_headers, params={'page': 999}).json()['components'] == []


def test_foreign_and_missing_documents_hidden(client, auth_headers, asset_id):
    _, foreign = seed(asset_id)
    assert client.get(f'/api/v1/sbom/{foreign}/component-evidence', headers=auth_headers).status_code == 404
    assert client.get('/api/v1/sbom/999999/component-evidence', headers=auth_headers).status_code == 404


@pytest.mark.parametrize('params', [{'gap': 'invalid'}, {'page': 0}, {'size': 101}, {'search': 'x' * 201}])
def test_invalid_filter_is_rejected(client, auth_headers, asset_id, params):
    identity, _ = seed(asset_id)
    response = client.get(f'/api/v1/sbom/{identity}/component-evidence', headers=auth_headers, params=params)
    assert response.status_code == 422
