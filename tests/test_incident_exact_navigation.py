"""Exact current incident filtering preserves owner scope and active qualification."""
import pytest

from backend.models.alert import Alert
from tests.test_incidents import _register_and_login, _seed, _TestingSessionLocal
from tests.test_incidents import client as client


class TestExactIncidentNavigation:
    def test_exact_asset_filter_keeps_owner_scope_and_current_qualification(self, client):
        owner = _register_and_login(client, "exact-owner@example.com")
        other = _register_and_login(client, "exact-other@example.com")
        owner_id = client.get("/api/v1/auth/me", headers=owner).json()["id"]
        other_id = client.get("/api/v1/auth/me", headers=other).json()["id"]
        first, second, hidden = _seed(owner_id), _seed(owner_id), _seed(other_id)
        response = client.get("/api/v1/incidents", params={"asset_id": second}, headers=owner)
        assert response.status_code == 200
        assert [row["asset_id"] for row in response.json()["incidents"]] == [second]
        assert response.json()["total"] == 1
        for asset_id in (hidden, 999999):
            response = client.get("/api/v1/incidents", params={"asset_id": asset_id}, headers=owner)
            assert response.status_code == 200 and response.json() == {"incidents": [], "total": 0}
        with _TestingSessionLocal() as db:
            for alert in db.query(Alert).filter(Alert.asset_id == second):
                alert.status = "resolved"
            db.commit()
        response = client.get("/api/v1/incidents", params={"asset_id": second}, headers=owner)
        assert response.json() == {"incidents": [], "total": 0}
        response = client.get("/api/v1/incidents", params={"asset_id": first}, headers=owner)
        assert response.json()["total"] == 1

    @pytest.mark.parametrize("asset_id", ["0", "-1", "1.2", "nope"])
    def test_invalid_exact_asset_is_rejected(self, client, asset_id):
        headers = _register_and_login(client, "exact-invalid@example.com")
        assert client.get("/api/v1/incidents", params={"asset_id": asset_id}, headers=headers).status_code == 422
