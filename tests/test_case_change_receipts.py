"""Owner-scoped saved investigation change receipts, never an inferred complete history."""
# ruff: noqa: F401, F811
import pytest
from test_case_assignment import _create_case, _register_and_login, _TestingSessionLocal, _user_id, client

from backend.models.audit_log import AuditLog
from backend.models.case import Case


def setup(client):
    headers = _register_and_login(client, 'owner@example.com')
    cid = _create_case(client, headers)
    owner = _user_id(client, headers)
    return headers, cid, owner


def test_exact_receipts_pagination_filter_and_scope(client):
    headers, cid, owner = setup(client)
    other_headers = _register_and_login(client, 'other@example.com')
    other = _user_id(client, other_headers)
    with _TestingSessionLocal() as db:
        for i in range(13):
            db.add(AuditLog(user_id=owner, target_type='case', target_id=cid,
                            action='case_priority_reviewed' if i % 2 else 'case_assignment_reviewed',
                            detail=f'Saved {i}'))
        db.add_all([AuditLog(user_id=other, target_type='case', target_id=cid, action='PRIVATE_ACTOR'),
                    AuditLog(user_id=owner, target_type='alert', target_id=cid, action='PRIVATE_TYPE'),
                    AuditLog(user_id=owner, target_type='case', target_id=cid + 1, action='PRIVATE_TARGET')])
        db.commit()
    result = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers).json()
    assert result['case_id'] == cid and result['page'] == 1 and result['size'] == 10
    assert result['total'] == 14 and len(result['records']) == 10
    assert all(row['actor_id'] == owner and 'PRIVATE' not in row['action'] for row in result['records'])
    page2 = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params={'page': 2}).json()
    assert len(page2['records']) == 4
    assert not {row['id'] for row in result['records']} & {row['id'] for row in page2['records']}
    priority = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers,
                          params={'category': 'priority'}).json()
    assert priority['total'] == 6
    assert all(row['action'] == 'case_priority_reviewed' for row in priority['records'])


def test_nonowner_and_assignee_cannot_read_owner_receipts(client):
    _, cid, _owner = setup(client)
    other_headers = _register_and_login(client, 'other@example.com')
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = _user_id(client, other_headers)
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}/change-receipts', headers=other_headers).status_code == 404


@pytest.mark.parametrize('params', [{'page': 0}, {'size': 0}, {'size': 51}, {'category': 'private'}])
def test_invalid_scope_rejected(client, params):
    headers, cid, _ = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params=params).status_code == 422


def test_empty_receipts_are_readonly(client):
    headers, cid, _ = setup(client)
    before = client.get(f'/api/v1/cases/{cid}', headers=headers).json()
    result = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers,
                        params={'category': 'priority'}).json()
    assert result['records'] == [] and result['total'] == 0
    assert client.get(f'/api/v1/cases/{cid}', headers=headers).json() == before


def test_literal_receipt_search_and_inclusive_utc_dates(client):
    from datetime import UTC, datetime
    headers, cid, owner = setup(client)
    with _TestingSessionLocal() as db:
        for stamp, detail in [('2026-11-21T23:59:59', 'needle 100%_exact'),
                              ('2026-11-22T00:00:00', 'needle 100%_exact'),
                              ('2026-11-22T23:59:59', 'needle 100%_exact'),
                              ('2026-11-23T00:00:00', 'needle 100%_exact'),
                              ('2026-11-22T12:00:00', 'needle 100xyzexact')]:
            db.add(AuditLog(user_id=owner, target_type='case', target_id=cid, action='case_priority_reviewed',
                            detail=detail, timestamp=datetime.fromisoformat(stamp).replace(tzinfo=UTC)))
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params={
        'search': ' 100%_exact ', 'from_date': '2026-11-22', 'through_date': '2026-11-22'})
    assert response.status_code == 200
    data = response.json()
    assert data['search'] == '100%_exact' and data['from_date'] == data['through_date'] == '2026-11-22'
    assert data['total'] == 2
    assert all('100%_exact' in row['detail'] for row in data['records'])


@pytest.mark.parametrize('params', [
    {'from_date': '2026-11-23', 'through_date': '2026-11-22'}, {'from_date': 'bad'},
    {'search': 'x' * 201}, {'through_date': '9999-12-31'},
])
def test_invalid_receipt_search_rejected(client, params):
    headers, cid, _ = setup(client)
    assert client.get(f'/api/v1/cases/{cid}/change-receipts', headers=headers, params=params).status_code == 422


def test_receipt_csv_exact_scope_safe_cells_utc_and_all_pages(client):
    import csv
    import io
    from datetime import UTC, datetime
    headers, cid, owner = setup(client)
    other_headers = _register_and_login(client, 'csv-other@example.com')
    other = _user_id(client, other_headers)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).title = '=PRIVATE_TITLE'
        for i in range(13):
            db.add(AuditLog(user_id=owner, target_type='case', target_id=cid,
                            action='case_priority_reviewed', detail='=100%_exact,"line"\nsecond',
                            timestamp=datetime(2026, 11, 22, i, tzinfo=UTC)))
        db.add_all([AuditLog(user_id=other, target_type='case', target_id=cid,
                            action='case_priority_reviewed', detail='PRIVATE_OTHER'),
                    AuditLog(user_id=owner, target_type='case', target_id=cid,
                            action='case_assignment_reviewed', detail='PRIVATE_CATEGORY'),
                    AuditLog(user_id=owner, target_type='case', target_id=cid+1,
                            action='case_priority_reviewed', detail='PRIVATE_CASE')])
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=headers,
                          params={'category': 'priority', 'search': '100%_exact',
                                  'from_date': '2026-11-22', 'through_date': '2026-11-22'})
    assert response.status_code == 200 and response.headers['content-type'].startswith('text/csv')
    assert response.headers['cache-control'] == 'no-store'
    assert f'investigation-{cid}-saved-receipts.csv' in response.headers['content-disposition']
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 13 and len({r['receipt_id'] for r in rows}) == 13
    assert rows[0]['recorded_at_utc'].endswith('+00:00') and 'T12:00:00' in rows[0]['recorded_at_utc']
    assert rows[0]['case_title'] == "'=PRIVATE_TITLE" and rows[0]['detail'] == "'=100%_exact,\"line\"\nsecond"
    assert all(r['actor_id'] == str(owner) and r['literal_search'] == '100%_exact' for r in rows)
    assert all('not complete history' in r['scope_note'] for r in rows)
    assert all(secret not in response.text for secret in ['PRIVATE_OTHER', 'PRIVATE_CATEGORY', 'PRIVATE_CASE'])
    assert client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=other_headers).status_code == 404


def test_empty_receipt_csv_records_scope_without_inventing_a_receipt(client):
    import csv
    import io
    headers, cid, _ = setup(client)
    result = client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=headers,
                        params={'category': 'priority', 'search': '=formula'})
    rows = list(csv.DictReader(io.StringIO(result.text)))
    assert result.status_code == 200 and len(rows) == 1
    assert rows[0]['receipt_id'] == rows[0]['actor_id'] == rows[0]['action'] == ''
    assert rows[0]['literal_search'] == "'=formula" and rows[0]['category'] == 'priority'


@pytest.mark.parametrize('params', [{'category': 'private'}, {'from_date': 'bad'},
    {'from_date': '2026-11-23', 'through_date': '2026-11-22'}, {'through_date': '9999-12-31'}])
def test_receipt_csv_invalid_scope_has_no_file(client, params):
    headers, cid, _ = setup(client)
    result = client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=headers, params=params)
    assert result.status_code == 422 and 'content-disposition' not in result.headers


def test_receipt_csv_refuses_over_limit_and_incomplete_reads(client, monkeypatch):
    from backend.routers import cases
    headers, cid, _ = setup(client)
    async def oversized(*args):
        return {'total': 5001, 'records': []}
    monkeypatch.setattr(cases, 'get_case_change_receipts', oversized)
    result = client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=headers)
    assert result.status_code == 422 and 'content-disposition' not in result.headers
    async def incomplete(*args):
        return {'total': 3, 'records': []}
    monkeypatch.setattr(cases, 'get_case_change_receipts', incomplete)
    result = client.get(f'/api/v1/cases/{cid}/change-receipts/export', headers=headers)
    assert result.status_code == 409 and 'content-disposition' not in result.headers
