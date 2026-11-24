"""Due triage views remain private criteria and accept no fixed UTC date."""
import pytest

from tests.test_saved_views import _seed_view_actor
from tests.test_saved_views import client as client


@pytest.mark.parametrize('scope', ['today', 'future', 'undated'])
def test_private_due_views_round_trip_with_no_fixed_date(client, scope):
    owner = _seed_view_actor(client, 'due-owner@example.com')
    other = _seed_view_actor(client, 'due-other@example.com')
    url = '/api/v1/cases/watchlist-views/'
    filters = {'query': 'gateway', 'kind': 'alert', 'severity': 'high', 'scope': scope, 'sort': 'due'}
    response = client.post(url, headers=owner, json={'name': 'Due triage', 'filters': filters})
    assert response.status_code == 201, response.text
    assert response.json()['filters'] == filters
    assert client.get(url, headers=other).json() == []
    for field in ('today', 'date_basis', 'records', 'watcher_ids'):
        bad = client.post(url, headers=owner, json={'name': 'Invalid', 'filters': {**filters, field: '2026-11-24'}})
        assert bad.status_code == 422
    assert client.get(url, headers=owner).json()[0]['filters'] == filters
