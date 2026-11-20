"""Guarded compliance edits preserve the exact saved evidence being reviewed."""
import pytest
from test_compliance import auth_headers as auth_headers
from test_compliance import client as client


def record(client, headers):
    response = client.post('/api/v1/compliance/controls/1/assessments', headers=headers, json={
        'status': 'partial', 'evidence_type': 'manual', 'evidence_detail': 'Original review',
    })
    assert response.status_code == 201
    return response.json()


def test_review_is_read_only_and_guarded_save_preserves_time(client, auth_headers):
    saved = record(client, auth_headers)
    path = f"/api/v1/compliance/assessments/{saved['id']}"
    review = client.get(path + '/review', headers=auth_headers).json()
    assert review['assessment'] == saved
    assert len(review['reviewed_fingerprint']) == 64
    payload = {'status': 'non_compliant', 'evidence_type': None, 'evidence_detail': None}
    response = client.patch(path, headers=auth_headers, json=payload,
                            params={'reviewed_fingerprint': review['reviewed_fingerprint']})
    assert response.status_code == 200
    assert all(response.json()[key] == value for key, value in payload.items())
    assert response.json()['assessed_at'] == saved['assessed_at']
    assert len(client.get('/api/v1/compliance/assessments', headers=auth_headers).json()) == 1
    refreshed = client.get(path + '/review', headers=auth_headers).json()
    assert refreshed['reviewed_fingerprint'] != review['reviewed_fingerprint']


@pytest.mark.parametrize('changed', [
    {'status': 'compliant'}, {'evidence_type': 'document'}, {'evidence_detail': 'Another reviewer edit'},
])
def test_stale_review_cannot_overwrite_changed_record(client, auth_headers, changed):
    saved = record(client, auth_headers)
    path = f"/api/v1/compliance/assessments/{saved['id']}"
    review = client.get(path + '/review', headers=auth_headers).json()
    newer = client.patch(path, headers=auth_headers, json={
        'status': saved['status'], 'evidence_type': saved['evidence_type'],
        'evidence_detail': saved['evidence_detail'], **changed,
    }).json()
    response = client.patch(path, headers=auth_headers,
                            params={'reviewed_fingerprint': review['reviewed_fingerprint']},
                            json={'status': 'not_applicable', 'evidence_detail': 'Stale draft'})
    assert response.status_code == 409
    assert client.get(path, headers=auth_headers).json() == newer


def test_review_and_guarded_write_keep_owner_boundary(client, auth_headers):
    saved = record(client, auth_headers)
    path = f"/api/v1/compliance/assessments/{saved['id']}"
    review = client.get(path + '/review', headers=auth_headers).json()
    client.post('/api/v1/auth/register', json={
        'email': 'review-other@example.com', 'password': 'test-review-password', 'full_name': 'Other reviewer',
    })
    login = client.post('/api/v1/auth/login', data={
        'username': 'review-other@example.com', 'password': 'test-review-password',
    })
    other = {'Authorization': f"Bearer {login.json()['access_token']}"}
    assert client.get(path + '/review', headers=other).status_code == 404
    assert client.patch(path, headers=other, params={'reviewed_fingerprint': review['reviewed_fingerprint']},
                        json={'status': 'compliant'}).status_code == 403
    assert client.get(path, headers=auth_headers).json() == saved
    assert client.get('/api/v1/compliance/assessments/999999/review', headers=auth_headers).status_code == 404


@pytest.mark.parametrize('fingerprint', ['x', 'A' * 64, 'z' * 64])
def test_invalid_fingerprint_does_not_fall_back_to_unguarded_save(client, auth_headers, fingerprint):
    saved = record(client, auth_headers)
    path = f"/api/v1/compliance/assessments/{saved['id']}"
    assert client.patch(path, headers=auth_headers, params={'reviewed_fingerprint': fingerprint},
                        json={'status': 'compliant'}).status_code == 422
    assert client.get(path, headers=auth_headers).json() == saved


def test_fingerprint_cannot_be_used_for_another_saved_record(client, auth_headers):
    first, second = record(client, auth_headers), record(client, auth_headers)
    path = f"/api/v1/compliance/assessments/{first['id']}"
    fingerprint = client.get(path + '/review', headers=auth_headers).json()['reviewed_fingerprint']
    response = client.patch(f"/api/v1/compliance/assessments/{second['id']}", headers=auth_headers,
                            params={'reviewed_fingerprint': fingerprint}, json={'status': 'compliant'})
    assert response.status_code == 409
