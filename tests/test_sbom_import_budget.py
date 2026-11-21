"""Enforce the existing 5 MiB client import budget at the authenticated API."""
import json

import pytest
from test_sbom import TestingSessionLocal
from test_sbom import asset_id as asset_id
from test_sbom import auth_headers as auth_headers
from test_sbom import client as client

from backend.models.sbom import SBOM, SBOMComponent
from backend.services.sbom_service import MAX_SBOM_DOCUMENT_BYTES, validate_sbom_document_budget


def test_compact_utf8_bytes_have_an_exact_inclusive_limit():
    overhead = len(json.dumps({'extra': ''}, separators=(',', ':')).encode())
    validate_sbom_document_budget({'extra': 'a' * (MAX_SBOM_DOCUMENT_BYTES - overhead)})
    with pytest.raises(ValueError):
        validate_sbom_document_budget({'extra': 'a' * (MAX_SBOM_DOCUMENT_BYTES - overhead + 1)})
    with pytest.raises(ValueError):
        validate_sbom_document_budget({'extra': '界' * (MAX_SBOM_DOCUMENT_BYTES // 3)})


@pytest.mark.parametrize('document', [
    {'bomFormat': 'CycloneDX', 'components': [{'name': 'valid component'}]},
    {'spdxVersion': 'SPDX-2.3', 'packages': [{'name': 'valid package'}]},
    {'unrecognized_format': True},
])
def test_oversized_documents_rejected_before_parsing_or_writing(client, auth_headers, asset_id, document):
    document['ignored_extension'] = 'synthetic-not-for-response' + 'x' * MAX_SBOM_DOCUMENT_BYTES
    with TestingSessionLocal() as db:
        before = db.query(SBOM).count(), db.query(SBOMComponent).count()
    response = client.post('/api/v1/sbom/upload', headers=auth_headers,
                           json={'asset_id': asset_id, 'sbom_data': document})
    assert response.status_code == 413
    assert len(response.content) < 300
    assert 'synthetic-not-for-response' not in response.text
    with TestingSessionLocal() as db:
        assert (db.query(SBOM).count(), db.query(SBOMComponent).count()) == before


def test_budget_does_not_replace_ownership_or_small_document_behavior(client, auth_headers, asset_id):
    oversized = {'bomFormat': 'CycloneDX', 'padding': 'x' * MAX_SBOM_DOCUMENT_BYTES}
    assert client.post('/api/v1/sbom/upload', headers=auth_headers, json={
        'asset_id': 999999, 'sbom_data': oversized}).status_code == 404
    client.cookies.clear()
    assert client.post('/api/v1/sbom/upload', json={
        'asset_id': asset_id, 'sbom_data': oversized}).status_code == 401
    result = client.post('/api/v1/sbom/upload', headers=auth_headers, json={
        'asset_id': asset_id, 'sbom_data': {'bomFormat': 'CycloneDX', 'components': [{'name': 'small'}]}})
    assert result.status_code == 201 and result.json()['component_count'] == 1


@pytest.mark.parametrize('value', ['\ud800', float('nan'), float('inf')])
def test_non_utf8_and_nonfinite_documents_return_safe_errors_without_storage(client, auth_headers, asset_id, value):
    response = client.post('/api/v1/sbom/upload', headers={**auth_headers, 'Content-Type': 'application/json'},
                           content=json.dumps({'asset_id': asset_id, 'sbom_data': {
                               'bomFormat': 'CycloneDX', 'invalid_extension': value}}))
    assert response.status_code == 400
    assert 'SBOM must be a finite UTF-8 JSON document' in response.text
    assert len(response.content) < 400
    with TestingSessionLocal() as db:
        assert db.query(SBOM).count() == db.query(SBOMComponent).count() == 0
