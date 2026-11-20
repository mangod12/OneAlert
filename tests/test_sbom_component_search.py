"""Cross-document component search keeps ownership, exact version and historical scope explicit."""
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
        second = Asset(user_id=owner, name='Second owned asset', asset_type='server')
        foreign = Asset(user_id=999, name='Private foreign asset', asset_type='server')
        db.add_all([second, foreign])
        db.flush()
        documents = [SBOM(user_id=owner, asset_id=asset_id, format='SPDX'),
                     SBOM(user_id=owner, asset_id=asset_id, format='CycloneDX'),
                     SBOM(user_id=owner, asset_id=second.id, format='SPDX'),
                     SBOM(user_id=999, asset_id=asset_id, format='SPDX'),
                     SBOM(user_id=owner, asset_id=foreign.id, format='SPDX')]
        db.add_all(documents)
        db.flush()
        for index in range(25):
            db.add(SBOMComponent(sbom_id=documents[index % 3].id, name='openssl',
                                version='3.0' if index % 2 else '3.0.1',
                                supplier='Saved supplier', purl='pkg:generic/openssl',
                                cpe='cpe:openssl', has_known_vulnerability=index % 2))
        db.add(SBOMComponent(sbom_id=documents[0].id, name='Literal 100%_library', version=None))
        db.add(SBOMComponent(sbom_id=documents[0].id, name='Unrelated version text', version='openssl'))
        for document in documents[3:]:
            db.add(SBOMComponent(sbom_id=document.id, name='openssl private',
                                version='3.0', supplier='Private supplier'))
        db.commit()


def test_all_retained_documents_are_paged_without_leaking_foreign_rows(client, auth_headers, asset_id):
    seed(asset_id)
    pages = [client.get('/api/v1/sbom/component-search', headers=auth_headers,
                        params={'search': ' openssl ', 'page': page}).json() for page in [1, 2, 3]]
    assert all(p['total'] == 25 and p['document_count'] == 3 and p['asset_count'] == 2 for p in pages)
    assert [len(p['records']) for p in pages] == [10, 10, 5]
    ids = [r['component']['id'] for p in pages for r in p['records']]
    assert len(set(ids)) == 25 and ids == sorted(ids, reverse=True)
    assert all(p['search'] == 'openssl' for p in pages)
    assert 'Private' not in str(pages)
    assert all(r['component']['sbom_id'] == r['sbom_id'] for p in pages for r in p['records'])


def test_exact_version_and_vulnerability_scope_applied_before_counts(client, auth_headers, asset_id):
    seed(asset_id)
    data = client.get('/api/v1/sbom/component-search', headers=auth_headers,
                      params={'search': 'OpenSSL', 'version': ' 3.0 ', 'vulnerable_only': True, 'page': 2}).json()
    assert data['total'] == 12 and len(data['records']) == 2
    assert data['version'] == '3.0' and data['vulnerable_only'] is True
    assert all(r['component']['version'] == '3.0' and r['component']['has_known_vulnerability'] == 1
               for r in data['records'])


@pytest.mark.parametrize('term,total', [('100%_', 1), ('pkg:generic/openssl', 25),
                                       ('Saved supplier', 25), ('cpe:openssl', 25), ('missing', 0)])
def test_literal_identifier_supplier_and_empty_search_results(client, auth_headers, asset_id, term, total):
    seed(asset_id)
    data = client.get('/api/v1/sbom/component-search', headers=auth_headers, params={'search': term}).json()
    assert data['total'] == total
    if not total:
        assert data['document_count'] == data['asset_count'] == 0 and data['records'] == []


@pytest.mark.parametrize('params', [{}, {'search': ''}, {'search': '   '}, {'search': 'x' * 201},
                                   {'search': 'ok', 'page': 0}, {'search': 'ok', 'size': 101},
                                   {'search': 'ok', 'version': 'x' * 201}])
def test_invalid_search_scope_rejected(client, auth_headers, asset_id, params):
    assert client.get('/api/v1/sbom/component-search', headers=auth_headers, params=params).status_code == 422
