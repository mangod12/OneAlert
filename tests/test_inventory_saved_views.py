"""Inventory saved views share existing storage, with strict query-only scope."""
import pytest

from tests.test_saved_views import _seed_view_actor
from tests.test_saved_views import client as client

URL = "/api/v1/inventory/views/"
FILTERS = {"search": "north gateway", "asset_type": "plc", "vendor": "Recorded vendor",
           "criticality": "high", "is_ot": False, "sort": "risk_desc"}


def create(client, headers, name="Gateway review", filters=None):
    return client.post(URL, headers=headers, json={"name": name, "filters": FILTERS if filters is None else filters})


def test_create_and_reopen_inventory_query_keeps_false_classification(client):
    headers = _seed_view_actor(client, "inventory@example.com")
    response = create(client, headers)
    assert response.status_code == 201, response.text
    view = response.json()
    assert view["scope"] == "assets" and view["filters"] == FILTERS
    assert client.get(URL, headers=headers).json() == [view]
    assert client.get("/api/v1/assets/views/", headers=headers).status_code == 422
    renamed = client.patch(f"{URL}{view['id']}", headers=headers, json={"name": "Renamed inventory view"})
    assert renamed.status_code == 200 and renamed.json()["filters"] == FILTERS
    assert client.delete(f"{URL}{view['id']}", headers=headers).status_code == 204
    assert client.get(URL, headers=headers).json() == []


def test_scope_and_user_isolation_for_reads_and_mutations(client):
    owner = _seed_view_actor(client, "inventory-owner@example.com")
    other = _seed_view_actor(client, "inventory-other@example.com")
    view = create(client, owner).json()
    assert client.get(URL, headers=other).json() == []
    for prefix, headers in [(URL, other), ("/api/v1/alerts/views/", owner), ("/api/v1/cases/views/", owner),
                            ("/api/v1/events/views/", owner)]:
        assert client.patch(f"{prefix}{view['id']}", headers=headers, json={"name": "Unauthorized"}).status_code == 404
        assert client.delete(f"{prefix}{view['id']}", headers=headers).status_code == 404
    assert create(client, owner, name="gateway REVIEW").status_code == 409
    assert client.post("/api/v1/alerts/views/", headers=owner,
                       json={"name": "Gateway review", "filters": {}}).status_code == 201
    assert len(client.get(URL, headers=owner).json()) == 1


@pytest.mark.parametrize("filters", [{"asset_id": 71}, {"comparison": [1, 2]}, {"page": 5}, {"is_ot": "maybe"},
                                      {"sort": "unsupported"}, {"criticality": "urgent"}, {"search": "x" * 201},
                                      {"vendor": "x" * 201}, {"asset_type": "x" * 101}])
def test_invalid_inventory_or_non_query_fields_rejected(client, filters):
    headers = _seed_view_actor(client, "inventory-invalid@example.com")
    assert create(client, headers, filters=filters).status_code == 422
    assert client.get(URL, headers=headers).json() == []


def test_empty_view_private_cap_and_auth(client):
    headers = _seed_view_actor(client, "inventory-cap@example.com")
    response = create(client, headers, filters={})
    assert response.status_code == 201 and response.json()["filters"] == {}
    for index in range(24):
        assert create(client, headers, name=f"Inventory {index}", filters={}).status_code == 201
    assert create(client, headers, name="Too many").status_code == 400
    client.cookies.clear()
    assert client.get(URL).status_code in (401, 403)
