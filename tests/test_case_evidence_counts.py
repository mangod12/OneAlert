"""Investigation counts represent distinct available owner evidence, not raw join rows."""
import csv
import io

import pytest
from test_case_linked_evidence import context as context


@pytest.mark.parametrize('view', ['detail', 'list', 'export'])
def test_counts_exclude_duplicate_missing_and_foreign_owner_references(context, view):
    client, _ = context
    if view == 'detail':
        response = client.get('/api/v1/cases/7')
        assert response.status_code == 200, response.text
        row = response.json()
    elif view == 'list':
        response = client.get('/api/v1/cases/')
        assert response.status_code == 200, response.text
        row = next(row for row in response.json()['cases'] if row['id'] == 7)
    else:
        response = client.get('/api/v1/cases/export')
        assert response.status_code == 200, response.text
        row = next(row for row in csv.DictReader(io.StringIO(response.text)) if row['id'] == '7')
    assert int(row['alert_count']) == int(row['event_count']) == 25


@pytest.mark.parametrize('scope,principal_id', [('assigned=me', 2), ('watching=me', 3)])
def test_collaborator_list_and_csv_use_case_owner_evidence_counts(context, scope, principal_id):
    client, principal = context
    principal['id'] = principal_id
    listing = client.get('/api/v1/cases/?' + scope)
    assert listing.status_code == 200, listing.text
    row = listing.json()['cases'][0]
    assert row['id'] == 7 and row['alert_count'] == row['event_count'] == 25
    exported = client.get('/api/v1/cases/export?' + scope)
    assert exported.status_code == 200, exported.text
    row = next(iter(csv.DictReader(io.StringIO(exported.text))))
    assert row['id'] == '7' and row['alert_count'] == row['event_count'] == '25'
