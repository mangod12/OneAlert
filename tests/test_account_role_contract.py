"""Current role is explicit in the public account and member schemas."""

import pytest

from tests.test_api_tokens import _register_and_login
from tests.test_api_tokens import client as token_client


@pytest.fixture
def client():
    yield from token_client.__wrapped__()


class TestVerifiedAccountRoleContract:
    def test_identity_and_member_metadata_include_current_role_without_secrets(self, client):
        headers = _register_and_login(client, "role-contract@example.com")
        before = client.get("/api/v1/auth/me", headers=headers)
        assert before.status_code == 200
        assert before.json()["role"] == "viewer"
        created = client.post("/api/v1/orgs/", headers=headers, json={
            "name": "Role Contract", "slug": "role-contract",
        })
        assert created.status_code == 201
        identity = client.get("/api/v1/auth/me", headers=headers)
        assert identity.status_code == 200
        assert identity.json()["role"] == "admin"
        members = client.get("/api/v1/orgs/me/members", headers=headers)
        assert members.status_code == 200
        assert len(members.json()) == 1
        assert members.json()[0]["role"] == "admin"
        assert identity.json()["org_id"] == created.json()["id"]
        forbidden = {"hashed_password", "slack_webhook_url", "webhook_url", "mfa_secret", "token_hash", "salt"}
        assert forbidden.isdisjoint(identity.json())
        assert forbidden.isdisjoint(members.json()[0])
