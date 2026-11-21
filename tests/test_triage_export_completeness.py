"""Triage exports either contain every matching row or refuse the whole CSV."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from test_case_export import client as client

from backend.routers.alerts import export_alerts
from backend.routers.cases import export_cases


def arguments(kind):
    common = dict(current_user=SimpleNamespace(id=7), search=None, severity=None,
                  assigned=None, watching=None, overdue=False)
    if kind == 'alerts':
        return {**common, 'status': None, 'asset_id': None, 'cve_id': None, 'snoozed': 'all',
                'min_age_days': None, 'max_age_days': None}
    return {**common, 'status_filter': None, 'sort': 'created_at_desc'}


@pytest.mark.parametrize('kind', ['alerts', 'cases'])
def test_limit_sentinel_refuses_before_serializing_a_partial_file(kind):
    db = AsyncMock()
    db.execute.return_value = Mock()
    db.execute.return_value.all.return_value = [object()] * 5001
    with pytest.raises(HTTPException) as error:
        asyncio.run((export_alerts if kind == 'alerts' else export_cases)(db=db, **arguments(kind)))
    assert error.value.status_code == 422 and 'No partial CSV' in error.value.detail
    query = db.execute.call_args.args[0]
    assert query._limit_clause.value == 5001
    assert f'{kind}.user_id' in str(query)
    db.commit.assert_not_awaited()


@pytest.mark.parametrize('kind', ['alerts', 'cases'])
def test_empty_complete_export_keeps_csv_contract(kind):
    db = AsyncMock()
    db.execute.return_value = Mock()
    db.execute.return_value.all.return_value = []
    response = asyncio.run((export_alerts if kind == 'alerts' else export_cases)(db=db, **arguments(kind)))
    assert response.media_type == 'text/csv'
    assert response.headers['content-disposition'] == f'attachment; filename={kind}.csv'


def test_http_exports_include_exact_limit_and_reject_overflow_after_filtering(client):
    import csv
    import io

    from test_case_export import _register_and_login, _TestingSessionLocal

    from backend.models.alert import Alert
    from backend.models.asset import Asset
    from backend.models.case import Case
    from backend.models.user import User

    headers = _register_and_login(client, 'export-boundary@example.com')
    with _TestingSessionLocal() as db:
        owner = db.query(User).filter_by(email='export-boundary@example.com').one()
        asset = Asset(user_id=owner.id, name='Owned asset', asset_type='server', vendor='Synthetic', product='Test')
        db.add(asset)
        db.flush()
        db.add_all([Case(user_id=owner.id, title=f'Record {i}', severity='high', status='open') for i in range(5000)])
        db.add_all([Alert(user_id=owner.id, asset_id=asset.id, title=f'Record {i}', severity='high', status='pending')
                    for i in range(5000)])
        db.commit()
        owner_id, asset_id = owner.id, asset.id
    for kind in ('alerts', 'cases'):
        response = client.get(f'/api/v1/{kind}/export', headers=headers)
        assert response.status_code == 200
        rows = list(csv.DictReader(io.StringIO(response.text)))
        assert len(rows) == len({row['id'] for row in rows}) == 5000
    with _TestingSessionLocal() as db:
        db.add(Case(user_id=owner_id, title='Overflow', severity='low', status='open'))
        db.add(Alert(user_id=owner_id, asset_id=asset_id, title='Overflow', severity='low', status='pending'))
        db.commit()
    for kind in ('alerts', 'cases'):
        refused = client.get(f'/api/v1/{kind}/export', headers=headers)
        assert refused.status_code == 422 and 'No partial CSV' in refused.text
        assert 'content-disposition' not in refused.headers
        filtered = client.get(f'/api/v1/{kind}/export', headers=headers, params={'severity': 'low'})
        assert filtered.status_code == 200
        assert [row['title'] for row in csv.DictReader(io.StringIO(filtered.text))] == ['Overflow']
