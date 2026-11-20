"""Linked evidence export shares the explorer's visibility and filters, without partial files."""
import csv
import io

import pytest
from test_case_linked_evidence import context as context


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_export_all_filtered_records_stable_and_distinct_with_provenance(context, kind):
    client, _ = context
    response = client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': kind})
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-evidence-record-count'] == '25'
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert [int(row['record_id']) for row in rows] == list(range(124, 99, -1))
    assert all(row['case_id'] == '7' and row['record_count'] == '25' and row['evidence_kind'] == kind
               and row['exported_at'] and row['applied_severity'] == 'all' for row in rows)
    assert 'Private' not in response.text and 'raw content' not in response.text
    filtered = client.get('/api/v1/cases/7/linked-evidence/export', params={
        'kind': kind, 'search': ' 100%_LITERAL ', 'severity': 'critical'})
    filtered_rows = list(csv.DictReader(io.StringIO(filtered.text)))
    assert len(filtered_rows) == 1 and filtered_rows[0]['record_id'] == '100'
    assert filtered_rows[0]['applied_search'] == '100%_LITERAL'
    assert filtered_rows[0]['applied_severity'] == 'critical'


@pytest.mark.parametrize('principal_id', [2, 3, 4])
def test_collaborators_export_only_existing_case_evidence_visibility(context, principal_id):
    client, principal = context
    principal['id'] = principal_id
    assert client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'event'}).status_code == 200
    assert client.get('/api/v1/cases/8/linked-evidence/export', params={'kind': 'event'}).status_code == 404
    principal['id'] = 5
    assert client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'event'}).status_code == 404


def test_empty_export_retains_headers_and_count(context):
    client, _ = context
    response = client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'alert', 'search': 'absent'})
    assert response.headers['x-evidence-record-count'] == '0'
    assert list(csv.DictReader(io.StringIO(response.text))) == []
    assert 'record_id' in response.text


def test_export_refuses_oversized_results_without_partial_csv(context, monkeypatch):
    client, _ = context
    monkeypatch.setattr('backend.routers.case_linked_evidence.EXPORT_LIMIT', 24)
    response = client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'event'})
    assert response.status_code == 413
    assert 'no partial file' in response.text
    assert 'Content-Disposition' not in response.headers


@pytest.mark.parametrize('params', [{}, {'kind': 'bad'}, {'kind': 'alert', 'severity': 'urgent'},
                                    {'kind': 'event', 'search': 'x' * 201}])
def test_export_rejects_invalid_filters(context, params):
    client, _ = context
    assert client.get('/api/v1/cases/7/linked-evidence/export', params=params).status_code == 422


def test_spreadsheet_formulas_are_presentation_protected_without_mutating_records(context):
    import asyncio

    from backend.database.db import get_async_db
    from backend.main import app
    from backend.models.alert import Alert
    from backend.models.case import Case
    client, _ = context
    async def change():
        async for db in app.dependency_overrides[get_async_db]():
            investigation = await db.get(Case, 7)
            investigation.title = '=HYPERLINK("https://invalid.example")'
            alert = await db.get(Alert, 100)
            alert.title = ' \t+SUM(1,2)'
            alert.description = 'two lines, first\nsecond "quoted" line'
            await db.commit()
    asyncio.run(change())
    response = client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'alert', 'search': '100'})
    row = next(iter(csv.DictReader(io.StringIO(response.text))))
    assert row['case_title'].startswith("'=") and row['title'] == "' \t+SUM(1,2)"
    assert row['description'] == 'two lines, first\nsecond "quoted" line'
    original = client.get('/api/v1/cases/7/linked-evidence', params={'kind': 'alert', 'search': '100'}).json()
    assert original['case_title'].startswith('=') and original['records'][0]['title'] == ' \t+SUM(1,2)'


def test_exact_export_limit_is_not_treated_as_truncation(context, monkeypatch):
    client, _ = context
    monkeypatch.setattr('backend.routers.case_linked_evidence.EXPORT_LIMIT', 25)
    response = client.get('/api/v1/cases/7/linked-evidence/export', params={'kind': 'alert'})
    assert response.status_code == 200
    assert len(list(csv.DictReader(io.StringIO(response.text)))) == 25
