"""Full comparison exports preserve owner-scoped exact sets, without raw evidence or page stitching."""
import asyncio

import pytest
from test_case_evidence_overlap import context as context

from backend.database.db import get_async_db
from backend.main import app
from backend.models.alert import Alert
from backend.models.case import Case


def export(client, **params):
    return client.get('/api/v1/cases/7/evidence-overlap/export', params={'other_case_id': 8, **params})


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_all_sets_are_complete_and_stable_beyond_first_page(context, kind):
    client, _ = context
    response = export(client, kind=kind)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert response.headers['x-evidence-record-count'] == '13'
    assert response.headers['content-disposition'].endswith(f'-{kind}-evidence-comparison.json')
    data = response.json()
    assert data['format'] == 'onealert_case_evidence_comparison_v1' and data['exported_at']
    assert data['case_id'] == 7 and data['other_case_id'] == 8 and data['kind'] == kind
    assert data['source_count'] == data['other_count'] == 12 and data['record_count'] == 13
    assert data['set_counts'] == {'shared': 11, 'source_only': 1, 'other_only': 1}
    assert [r['id'] for r in data['records']['shared']] == list(range(110, 99, -1))
    assert [r['id'] for r in data['records']['source_only']] == [111]
    assert [r['id'] for r in data['records']['other_only']] == [112]
    assert export(client, kind=kind).json()['records'] == data['records']
    assert 'Private' not in response.text and '999' not in response.text
    assert 'payload-not-returned' not in response.text and 'Not part of overlap' not in response.text
    assert 'not an immutable historical version' in data['scope']


@pytest.mark.parametrize('user', [2, 3, 4])
def test_existing_collaborator_visibility_does_not_grant_original_access(context, user):
    client, principal = context
    principal['id'] = user
    data = export(client).json()
    assert all(not r['can_open_original'] for group in data['records'].values() for r in group)
    principal['id'] = 5
    assert export(client).status_code == 404


@pytest.mark.parametrize('kind', ['alert', 'event'])
def test_different_owner_cases_keep_both_evidence_owner_boundaries(context, kind):
    client, principal = context
    principal['id'] = 2
    data = export(client, kind=kind, other_case_id=10).json()
    assert data['set_counts'] == {'shared': 0, 'source_only': 12, 'other_only': 1}
    assert [r['id'] for r in data['records']['other_only']] == [900]
    assert all(not r['can_open_original'] for group in data['records'].values() for r in group)


@pytest.mark.parametrize('other', [9, 999])
def test_missing_and_invisible_cases_are_indistinguishable(context, other):
    response = export(context[0], other_case_id=other)
    assert response.status_code == 404
    assert response.json()['error']['message'] == 'Investigation not found'
    assert 'content-disposition' not in response.headers


@pytest.mark.parametrize('limit,status', [(12, 413), (13, 200)])
def test_union_limit_is_fail_closed_without_partial_file(context, monkeypatch, limit, status):
    monkeypatch.setattr('backend.routers.case_linked_evidence.EXPORT_LIMIT', limit)
    response = export(context[0])
    assert response.status_code == status
    if status == 413:
        assert 'No partial file' in response.text and 'content-disposition' not in response.headers


@pytest.mark.parametrize('params', [{'other_case_id': 7}, {'other_case_id': 0},
                                   {'other_case_id': 2147483648}, {'kind': 'raw'}])
def test_rejects_invalid_selection(context, params):
    assert export(context[0], **params).status_code == 422


def test_empty_side_retains_full_metadata_and_literal_text_is_not_html(context):
    client, _ = context
    async def change():
        async for db in app.dependency_overrides[get_async_db]():
            source = await db.get(Case, 7)
            source.title = '<b>Source literal title</b>'
            alert = await db.get(Alert, 111)
            alert.title = '=literal, not a spreadsheet\n"quoted"'
            await db.commit()
    asyncio.run(change())
    data = export(client, other_case_id=11).json()
    assert data['case_title'] == '<b>Source literal title</b>'
    assert data['set_counts'] == {'shared': 0, 'source_only': 12, 'other_only': 0}
    assert data['records']['source_only'][0]['label'] == '=literal, not a spreadsheet\n"quoted"'
    original = client.get('/api/v1/cases/7/evidence-overlap', params={
        'other_case_id': 8, 'relation': 'source_only'}).json()
    assert original['records'][0]['label'] == data['records']['source_only'][0]['label']
