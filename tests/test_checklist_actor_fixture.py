"""Checklist setup keeps independent users and production authentication."""
# ruff: noqa: F401, F811
from test_case_tasks import _seed_checklist_actor, _register_and_login, _TestingSessionLocal, client

from backend.models.user import User
from backend.services.auth_service import create_access_token, pwd_context


def test_checklist_actor_keeps_token_validation_and_active_database_identity(client):
    first = _seed_checklist_actor(client, 'first@example.com')
    second = _seed_checklist_actor(client, 'second@example.com')
    one = client.get('/api/v1/auth/me', headers=first).json()
    two = client.get('/api/v1/auth/me', headers=second).json()
    assert one['id'] != two['id']
    assert one['email'] == 'first@example.com' and two['email'] == 'second@example.com'
    with _TestingSessionLocal() as db:
        user = db.get(User, one['id'])
        assert user.hashed_password is None
        assert user.full_name == 'Analyst' and user.is_active and not user.is_verified
        user.is_active = False
        db.commit()
    assert client.get('/api/v1/auth/me', headers=first).status_code == 403
    assert client.get('/api/v1/auth/me', headers=second).status_code == 200
    token = second['Authorization'].split()[1]
    replacement = 'A' if token[0] != 'A' else 'B'
    assert client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {replacement}{token[1:]}'}).status_code == 401
    unknown = create_access_token({'sub': 'missing@example.com'})
    assert client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {unknown}'}).status_code == 401
    assert client.get('/api/v1/auth/me').status_code == 401
    assert client.post('/api/v1/auth/login', data={'username': 'second@example.com', 'password': 'securepass123'}).status_code == 401


def test_explicit_checklist_registration_helper_keeps_real_production_hashing(client):
    headers = _register_and_login(client, 'real-password@example.com')
    one = client.get('/api/v1/auth/me', headers=headers).json()
    with _TestingSessionLocal() as db:
        hashed = db.get(User, one['id']).hashed_password
        assert pwd_context.identify(hashed) == 'bcrypt'
        assert int(hashed.split('$')[2]) == 12
        assert pwd_context.verify('securepass123', hashed)
        assert not pwd_context.verify('wrong-password', hashed)
