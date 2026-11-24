"""Read-only due triage spans both record types without widening follower scope."""
from datetime import UTC, datetime, timedelta

import pytest

from backend.models.alert import Alert
from backend.models.case import Case
from backend.services import watchlist_search
from tests.test_case_watchers import _TestingSessionLocal
from tests.test_watchlist_explorer import client as client
from tests.test_watchlist_explorer import fetch, seed


@pytest.mark.parametrize('scope,offset', [('today', 0), ('future', 1), ('undated', None)])
def test_due_triage_is_active_exact_utc_and_follow_scoped(client, monkeypatch, scope, offset):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 24, 0, 1, tzinfo=UTC)

    monkeypatch.setattr(watchlist_search, 'datetime', Clock)
    owner, follower, stranger, _ = seed(client)
    today = Clock.now(UTC).date()
    with _TestingSessionLocal() as db:
        for model in (Alert, Case):
            for i, status, due in [(1, 'open', offset), (2, 'resolved', offset),
                                   (3, 'closed', offset), (4, 'false_positive', offset),
                                   (5, 'open', -1), (6, 'open', 1), (7, 'open', 0),
                                   (8, None, offset),
                                   (134, 'open', offset)]:
                row = db.get(model, i)
                row.due_date = today + timedelta(days=due) if due is not None else None
                row.status = status
        db.commit()
    result = fetch(client, follower, scope=scope, sort='due')
    assert result['date_basis'] == '2026-11-24'
    assert result['summary']['done'] == result['summary']['overdue'] == 0
    assert result['summary']['active'] == result['total']
    if scope == 'undated':
        assert result['summary']['active_without_due_date'] == result['total']
    else:
        assert result['summary']['active_without_due_date'] == 0
    rows = []
    for page in range(1, (result['total'] + 24) // 25 + 1):
        rows.extend(fetch(client, follower, scope=scope, sort='due', page=page)['data'])
    assert len(rows) == result['total'] > 0
    assert len({(r['kind'], r['id']) for r in rows}) == len(rows)
    assert {r['kind'] for r in rows} == {'alert', 'case'}
    assert all(r['id'] not in (2, 3, 4, 5, 134) for r in rows)
    assert all(r['due_date'] is None if scope == 'undated' else
               r['due_date'] == '2026-11-24' if scope == 'today' else
               r['due_date'] > '2026-11-24' for r in rows)
    assert fetch(client, owner, scope=scope)['total'] == 0
    assert fetch(client, stranger, scope=scope)['total'] == 2
