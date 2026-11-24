"""Workflow fixture setup keeps real token validation and independent users."""
import pytest

from backend.models.user import User
from backend.services.auth_service import create_access_token
from tests import test_case_watchers as watchers
from tests import test_saved_views as views


@pytest.mark.parametrize('module,seed_name', [
    (watchers, '_seed_watchlist_actor'), (views, '_seed_view_actor'),
])
def test_seeded_workflow_identity_keeps_real_authentication(module, seed_name):
    fixture = module.client.__wrapped__()
    client = next(fixture)
    try:
        seed = getattr(module, seed_name)
        first = seed(client, 'first@example.com')
        second = seed(client, 'second@example.com')
        one = client.get('/api/v1/auth/me', headers=first).json()
        two = client.get('/api/v1/auth/me', headers=second).json()
        assert one['id'] != two['id']
        assert one['email'] == 'first@example.com'
        assert two['email'] == 'second@example.com'
        assert one['full_name'] == two['full_name'] == 'Analyst'
        with module._TestingSessionLocal() as db:
            actor = db.get(User, one['id'])
            assert actor.hashed_password is None
            assert actor.is_active and not actor.is_verified
            actor.is_active = False
            db.commit()
        assert client.get('/api/v1/auth/me', headers=first).status_code == 403
        assert client.get('/api/v1/auth/me', headers=second).status_code == 200
        assert client.get('/api/v1/auth/me').status_code == 401
        unknown = create_access_token({'sub': 'missing@example.com'})
        assert client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {unknown}'}).status_code == 401
        token = second['Authorization'].split()[1]
        replacement = 'A' if token[0] != 'A' else 'B'
        tampered = {'Authorization': f'Bearer {replacement}{token[1:]}'}
        assert client.get('/api/v1/auth/me', headers=tampered).status_code == 401
    finally:
        fixture.close()
