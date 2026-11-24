"""Seeded workflow actors still pass through production token authentication."""
# ruff: noqa: F401, F811
from test_case_assignment import _seed_case_actor, _TestingSessionLocal, client

from backend.models.user import User
from backend.services.auth_service import create_access_token


def test_actor_uses_real_authentication_and_separate_database_identity(client):
    first = _seed_case_actor(client, 'first@example.com')
    second = _seed_case_actor(client, 'second@example.com')
    one = client.get('/api/v1/auth/me', headers=first).json()
    two = client.get('/api/v1/auth/me', headers=second).json()
    assert one['id'] != two['id']
    assert one['email'] == 'first@example.com' and two['email'] == 'second@example.com'
    with _TestingSessionLocal() as db:
        actor = db.get(User, one['id'])
        assert actor.hashed_password is None and actor.company == 'TestCorp'
        assert actor.is_active and not actor.is_verified
        actor.is_active = False
        db.commit()
    assert client.get('/api/v1/auth/me', headers=first).status_code == 403
    assert client.get('/api/v1/auth/me', headers=second).status_code == 200


def test_fixture_does_not_replace_token_validation_or_accept_unknown_user(client):
    headers = _seed_case_actor(client, 'actor@example.com')
    token = headers['Authorization'].split()[1]
    replacement = 'A' if token[0] != 'A' else 'B'
    tampered = {'Authorization': f'Bearer {replacement}{token[1:]}'}
    assert client.get('/api/v1/auth/me', headers=tampered).status_code == 401
    missing = create_access_token({'sub': 'missing@example.com'})
    assert client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {missing}'}).status_code == 401
    assert client.get('/api/v1/auth/me').status_code == 401
