"""SPDX evidence validation rejects the whole document before writing rows."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from backend.models.sbom import SBOMUpload
from backend.routers.sbom import upload_sbom
from backend.services.sbom_service import parse_spdx


@pytest.mark.parametrize('bad', [
    {'name': {}}, {'name': '  '}, {'versionInfo': []}, {'supplier': {}},
    {'licenseConcluded': {}}, {'licenseDeclared': []}, {'externalRefs': None},
    {'externalRefs': [None]}, {'externalRefs': [{'referenceType': []}]},
    {'externalRefs': [{'referenceType': 'purl', 'referenceLocator': {}}]},
    {'checksums': {}}, {'checksums': [False]},
    {'checksums': [{'algorithm': 'SHA256', 'checksumValue': []}]},
])
def test_malformed_spdx_fields_fail_before_any_sbom_or_component_write(bad):
    package = {'name': 'package', **bad}
    data = {'spdxVersion': 'SPDX-2.3', 'packages': [{'name': 'valid'}, package]}
    result = Mock()
    result.scalar_one_or_none.return_value = SimpleNamespace(id=1)
    db = Mock(execute=AsyncMock(return_value=result), flush=AsyncMock(), commit=AsyncMock(), add=Mock())
    with pytest.raises(HTTPException) as failure:
        asyncio.run(upload_sbom(SBOMUpload(asset_id=1, sbom_data=data), SimpleNamespace(id=9), db))
    assert failure.value.status_code == 400
    assert 'Invalid SPDX component evidence:' in failure.value.detail
    assert 'packages[1]' in failure.value.detail
    db.add.assert_not_called()
    db.flush.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize('data', [
    {'spdxVersion': None}, {'spdxVersion': {}}, {'spdxVersion': 'bad'},
    {'spdxVersion': 'SPDX-2.3', 'packages': None},
    {'spdxVersion': 'SPDX-2.3', 'packages': {}},
    {'spdxVersion': 'SPDX-2.3', 'packages': [None]},
])
def test_malformed_spdx_envelope_is_not_accepted_as_an_empty_inventory(data):
    with pytest.raises(ValueError):
        parse_spdx(data)


def test_recorded_fields_and_missing_optional_values_are_preserved_without_coercion():
    document = {'spdxVersion': 'SPDX-2.3', 'packages': [
        {'name': 'gateway', 'versionInfo': '1.2', 'supplier': 'Organization: Vendor',
         'licenseConcluded': 'MIT OR Apache-2.0', 'licenseDeclared': 'GPL-2.0-only',
         'externalRefs': [{'referenceType': 'purl', 'referenceLocator': 'pkg:generic/gateway@1.2'},
                          {'referenceType': 'cpe23Type', 'referenceLocator': 'cpe:2.3:a:vendor:gateway:1.2'}],
         'checksums': [{'algorithm': 'SHA256', 'checksumValue': 'recorded-not-verified'}]},
        {'name': 'unknown', 'supplier': 'NOASSERTION', 'licenseConcluded': 'NOASSERTION'},
    ]}
    first, second = parse_spdx(document)
    assert first == {'name': 'gateway', 'version': '1.2', 'supplier': 'Organization: Vendor',
                     'purl': 'pkg:generic/gateway@1.2', 'cpe': 'cpe:2.3:a:vendor:gateway:1.2',
                     'license': 'MIT OR Apache-2.0', 'hash_sha256': 'recorded-not-verified'}
    assert second['supplier'] is None and second['license'] is None and second['version'] == ''
    assert document['packages'][1]['licenseConcluded'] == 'NOASSERTION'
    assert parse_spdx({'spdxVersion': 'SPDX-2.3'}) == []
