"""Null PATCH fields cannot violate stored integration response contracts."""
import pytest
from test_integrations import TestingSessionLocal
from test_integrations import auth_headers as auth_headers
from test_integrations import client as client

from backend.models.audit_log import AuditLog
from backend.models.integration_config import IntegrationConfig, IntegrationConfigUpdate


@pytest.mark.parametrize('field', ['name', 'config', 'is_active'])
def test_explicit_null_rejected_before_any_saved_value_or_audit_changes(client, auth_headers, field):
    created = client.post('/api/v1/integrations/', headers=auth_headers, json={
        'integration_type': 'pagerduty', 'name': 'Original', 'config': {'routing_key': 'synthetic-value'},
    }).json()['data']
    with TestingSessionLocal() as db:
        before_audits = db.query(AuditLog).count()
    payload = {'name': 'Do not persist', 'is_active': False, field: None}
    response = client.patch(f"/api/v1/integrations/{created['id']}", headers=auth_headers, json=payload)
    assert response.status_code == 422
    with TestingSessionLocal() as db:
        stored = db.get(IntegrationConfig, created['id'])
        assert stored.name == 'Original' and stored.is_active is True
        assert stored.config == {'routing_key': 'synthetic-value'}
        assert db.query(AuditLog).count() == before_audits
    assert client.get('/api/v1/integrations/', headers=auth_headers).status_code == 200


def test_omitted_fields_false_and_nested_secret_clear_keep_existing_semantics(client, auth_headers):
    assert IntegrationConfigUpdate().model_dump(exclude_unset=True) == {}
    created = client.post('/api/v1/integrations/', headers=auth_headers, json={
        'integration_type': 'pagerduty', 'name': 'Original', 'config': {'routing_key': 'synthetic-value'},
    }).json()['data']
    path = f"/api/v1/integrations/{created['id']}"
    result = client.patch(path, headers=auth_headers, json={'is_active': False})
    assert result.status_code == 200 and result.json()['data']['is_active'] is False
    result = client.patch(path, headers=auth_headers, json={'config': {}})
    assert result.status_code == 200 and result.json()['data']['name'] == 'Original'
    result = client.patch(path, headers=auth_headers, json={'config': {'routing_key': None}})
    assert result.status_code == 200 and result.json()['data']['config']['routing_key'] is None
