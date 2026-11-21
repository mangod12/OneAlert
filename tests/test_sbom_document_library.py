"""Owned document metadata discovery is bounded and independent of component text."""
from datetime import UTC, datetime

import pytest
from test_sbom import TestingSessionLocal
from test_sbom import asset_id as asset_id
from test_sbom import auth_headers as auth_headers
from test_sbom import client as client

from backend.models.asset import Asset
from backend.models.sbom import SBOM, SBOMComponent


def seed(asset_id):
    with TestingSessionLocal() as db:
        asset = db.get(Asset, asset_id)
        asset.name = 'Gateway 100%_safe'
        foreign = Asset(user_id=999, name='Private foreign asset name', asset_type='hardware')
        db.add(foreign)
        db.flush()
        for index in range(23):
            db.add(SBOM(user_id=asset.user_id, asset_id=asset_id, format='SPDX', source='vendor_provided',
                        version='1.0', component_count=index, vulnerability_count=1 if index % 2 else 0,
                        created_at=datetime(2026, 11, 1, tzinfo=UTC)))
        hidden = SBOM(user_id=999, asset_id=asset_id, format='Private-format', source='Private-source')
        orphan = SBOM(user_id=asset.user_id, asset_id=foreign.id, format='CycloneDX', source='scan')
        db.add_all([hidden, orphan])
        db.flush()
        db.add(SBOMComponent(sbom_id=orphan.id, name='not-document-searchable', has_known_vulnerability=0))
        db.commit()
        return foreign.id, orphan.id


@pytest.mark.parametrize('sort,reverse', [('newest', True), ('oldest', False)])
def test_full_owned_literal_scope_pages_and_options(client, auth_headers, asset_id, sort, reverse):
    seed(asset_id)
    params = {'query': '  100%_SAFE ', 'document_format': 'SPDX', 'source': 'vendor_provided',
              'asset_id': asset_id, 'sort': sort}
    pages = [client.get('/api/v1/sbom/document-library', params={**params, 'page': page},
                        headers=auth_headers).json() for page in (1, 2, 3)]
    assert [len(data['documents']) for data in pages] == [10, 10, 3]
    assert all(data['total'] == 23 and data['query'] == '100%_SAFE' for data in pages)
    ids = [row['id'] for data in pages for row in data['documents']]
    assert len(set(ids)) == 23 and ids == sorted(ids, reverse=reverse)
    assert pages[0]['formats'] == ['CycloneDX', 'SPDX']
    assert pages[0]['sources'] == ['scan', 'vendor_provided']
    assert all(row['asset_name'] == 'Gateway 100%_safe' for data in pages for row in data['documents'])


def test_foreign_names_docs_and_component_contents_are_not_disclosed_or_searched(client, auth_headers, asset_id):
    foreign, orphan = seed(asset_id)
    path = '/api/v1/sbom/document-library'
    data = client.get(path, headers=auth_headers).json()
    assert data['total'] == 24
    assert 'Private' not in str(data)
    for query in ['Private foreign asset name', 'not-document-searchable', 'Private-format', 'absent']:
        assert client.get(path, headers=auth_headers, params={'query': query}).json()['total'] == 0
    rows = client.get(path, headers=auth_headers, params={'asset_id': foreign}).json()['documents']
    assert len(rows) == 1 and rows[0]['id'] == orphan and rows[0]['asset_name'] is None
    assert client.get(path, headers=auth_headers, params={'page': 999}).json()['documents'] == []


def test_recorded_vulnerability_filter_is_before_pagination_and_reads_do_not_mutate(client, auth_headers, asset_id):
    seed(asset_id)
    path = '/api/v1/sbom/document-library'
    first = client.get(path, headers=auth_headers, params={'vulnerabilities_only': True}).json()
    second = client.get(path, headers=auth_headers, params={'vulnerabilities_only': True, 'page': 2}).json()
    assert first['total'] == second['total'] == 11
    assert len(first['documents']) == 10 and len(second['documents']) == 1
    assert all(row['vulnerability_count'] == 1 for row in first['documents'] + second['documents'])
    again = client.get(path, headers=auth_headers, params={'vulnerabilities_only': True}).json()
    assert again['documents'] == first['documents']


@pytest.mark.parametrize('params', [
    {'asset_id': 0}, {'page': 0}, {'size': 101}, {'query': 'x' * 201}, {'sort': 'invalid'},
])
def test_invalid_scope_rejected(client, auth_headers, params):
    assert client.get('/api/v1/sbom/document-library', headers=auth_headers, params=params).status_code == 422
