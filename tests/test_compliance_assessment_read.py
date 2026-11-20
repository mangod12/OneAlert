"""Exact compliance assessment reads preserve owner boundaries and current state."""
from test_compliance import auth_headers as auth_headers
from test_compliance import client as client


def test_exact_assessment_read_is_current_owned_and_has_no_side_effects(client, auth_headers):
    payload = {'status': 'partial', 'evidence_type': 'manual', 'evidence_detail': 'Original evidence'}
    created = client.post('/api/v1/compliance/controls/1/assessments', headers=auth_headers, json=payload).json()
    path = f"/api/v1/compliance/assessments/{created['id']}"
    response = client.get(path, headers=auth_headers)
    assert response.status_code == 200 and response.json() == created
    updated = client.patch(path, headers=auth_headers, json={**payload, 'evidence_detail': 'Edited evidence'}).json()
    assert client.get(path, headers=auth_headers).json() == updated
    assert len(client.get('/api/v1/compliance/assessments', headers=auth_headers).json()) == 1
    assert client.get('/api/v1/compliance/assessments/999999', headers=auth_headers).status_code == 404
    response = client.post('/api/v1/auth/register', json={
        'email': 'exact-assessment-other@example.com', 'password': 'test-assessment-password',
        'full_name': 'Other reviewer',
    })
    assert response.status_code in (200, 201)
    login = client.post('/api/v1/auth/login', data={
        'username': 'exact-assessment-other@example.com', 'password': 'test-assessment-password',
    })
    assert login.status_code == 200
    other = {'Authorization': f"Bearer {login.json()['access_token']}"}
    assert client.get(path, headers=other).status_code == 404
