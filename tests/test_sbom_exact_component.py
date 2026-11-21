"""Exact component evidence is bound to its owned document, not a name match or global ID."""
import pytest
from test_sbom import TestingSessionLocal
from test_sbom_component_evidence import asset_id as asset_id
from test_sbom_component_evidence import auth_headers as auth_headers
from test_sbom_component_evidence import client as client
from test_sbom_component_evidence import seed

from backend.models.sbom import SBOMComponent


def test_exact_component_lookup_reaches_a_later_record_without_loading_prior_pages(client, auth_headers, asset_id):
    document, _ = seed(asset_id)
    with TestingSessionLocal() as db:
        identity = db.query(SBOMComponent.id).filter_by(sbom_id=document).order_by(SBOMComponent.id.desc()).first()[0]
    response = client.get(f'/api/v1/sbom/{document}/component-evidence', headers=auth_headers,
                          params={'component_id': identity})
    assert response.status_code == 200
    data = response.json()
    assert data['component_id'] == identity and data['total'] == 1 and data['document_total'] == 23
    assert [row['id'] for row in data['components']] == [identity]
    assert data['components'][0]['sbom_id'] == document


def test_other_document_foreign_and_missing_components_do_not_fall_back(client, auth_headers, asset_id):
    document, foreign = seed(asset_id)
    with TestingSessionLocal() as db:
        own_id = db.query(SBOMComponent.id).filter_by(sbom_id=document).first()[0]
        foreign_id = db.query(SBOMComponent.id).filter_by(sbom_id=foreign).first()[0]
    for doc, identity in [(document, foreign_id), (foreign, own_id), (document, 2147483647)]:
        response = client.get(f'/api/v1/sbom/{doc}/component-evidence', headers=auth_headers,
                              params={'component_id': identity})
        assert response.status_code == 404 and 'Foreign private component' not in response.text


@pytest.mark.parametrize('identity', [0, -1, 'bad', 2147483648])
def test_invalid_exact_component_is_rejected(client, auth_headers, asset_id, identity):
    document, _ = seed(asset_id)
    assert client.get(f'/api/v1/sbom/{document}/component-evidence', headers=auth_headers,
                      params={'component_id': identity}).status_code == 422
