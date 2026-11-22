"""Selected candidate records use actual pipeline grouping, with guarded ordered membership."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from test_events_export import _register_and_login, _TestingSessionLocal
from test_events_export import client as client
from test_triage_correlation_preview import context as context

from backend.models.case import AgentRun, Case
from backend.models.security_event import SecurityEvent
from backend.models.user import User
from backend.services.agents.triage import TriageAgent


def selected(client, page=2):
    return client.get('/api/v1/cases/triage-correlation', params={'page': page}).json()['records'][-1]


def read(client, group, **changes):
    return client.get(f"/api/v1/cases/triage-correlation/{group['position']}/members",
                      params={'membership': group['membership_fingerprint'], **changes})


def test_actual_transitive_members_and_context_flags_without_ai_or_writes(context):
    client, _, sessions = context
    group = selected(client)
    with patch.object(TriageAgent, 'execute', new_callable=AsyncMock) as execute, patch(
            'backend.services.agents.triage.get_ai_provider') as provider:
        response = read(client, group)
        assert response.status_code == 200
        data = response.json()
        assert [row['id'] for row in data['records']] == [3, 2, 1]
        assert [row['intake_position'] for row in data['records']] == [1, 2, 3]
        assert all(row['included_in_ai_context'] and row['kind'] == 'event' for row in data['records'])
        assert data['total'] == data['event_count'] == 3 and data['alert_count'] == 0
        assert data['membership_fingerprint'] == group['membership_fingerprint']
        assert 'Foreign' not in str(data) and 'Future' not in str(data) and 'Excluded info' not in str(data)
        execute.assert_not_awaited()
        provider.assert_not_called()
    async def verify():
        async with sessions() as db:
            for model in [Case, AgentRun]:
                assert (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0
            assert (await db.execute(select(func.count()).select_from(SecurityEvent).where(
                SecurityEvent.processed == 'in_case'))).scalar_one() == 0
    asyncio.run(verify())


def test_changed_membership_position_owner_and_lookback_require_new_preview(context):
    client, principal, sessions = context
    group = selected(client)
    assert read(client, group, hours_back=24).status_code == 409
    principal['id'] = 2
    assert read(client, group).status_code == 409
    principal['id'] = 1
    async def change():
        async with sessions() as db:
            row = await db.get(SecurityEvent, 1)
            row.processed = 'in_case'
            await db.commit()
    asyncio.run(change())
    assert read(client, group).status_code == 409


def test_metadata_changes_do_not_claim_a_frozen_snapshot(context):
    client, _, sessions = context
    group = selected(client)
    async def change():
        async with sessions() as db:
            row = await db.get(SecurityEvent, 3)
            row.signature = 'Changed saved label'
            await db.commit()
    asyncio.run(change())
    data = read(client, group).json()
    assert data['records'][0]['label'] == 'Changed saved label'
    assert 'Metadata can change' in data['scope']


def test_full_group_pages_include_omitted_ai_context_members_in_intake_order(context, monkeypatch):
    client, _, _ = context
    events = [SimpleNamespace(id=index, signature=f'Event {index}', severity='high', timestamp=None,
                              source_ip='a', dest_ip='b') for index in range(1, 54)]
    monkeypatch.setattr(TriageAgent, '_get_untriaged_alerts', AsyncMock(return_value=[]))
    monkeypatch.setattr(TriageAgent, '_get_untriaged_events', AsyncMock(return_value=events))
    group = selected(client, 1)
    pages = [read(client, group, page=p).json() for p in range(1, 7)]
    rows = [row for page in pages for row in page['records']]
    assert [row['id'] for row in rows] == list(range(1, 54))
    assert sum(row['included_in_ai_context'] for row in rows) == 50
    assert all(page['total'] == 53 for page in pages)
    assert [row['id'] for row in rows if not row['included_in_ai_context']] == [51, 52, 53]
    assert read(client, group, page=100).json()['records'] == []
    # Order, even with identical ID membership, matters for the AI input caps.
    events.reverse()
    assert read(client, group).status_code == 409


def test_alerts_have_exact_links_metadata_and_current_input_cap(context, monkeypatch):
    client, _, _ = context
    alerts = [SimpleNamespace(id=index, title=f'Alert {index}', severity=None, created_at=None)
              for index in range(1, 24)]
    monkeypatch.setattr(TriageAgent, '_get_untriaged_alerts', AsyncMock(return_value=alerts))
    monkeypatch.setattr(TriageAgent, '_get_untriaged_events', AsyncMock(return_value=[]))
    monkeypatch.setattr(TriageAgent, '_group_by_correlation', lambda *args: [{'alerts': alerts, 'events': []}])
    group = selected(client, 1)
    data = read(client, group, page=3).json()
    assert data['alert_ai_input_count'] == 20 and data['event_count'] == 0
    assert [row['id'] for row in data['records']] == [21, 22, 23]
    assert all(not row['included_in_ai_context'] and row['kind'] == 'alert' for row in data['records'])


@pytest.mark.parametrize('changes', [{'membership': 'bad'}, {'membership': 'A' * 64},
    {'membership': 'a' * 65}, {'page': 0}, {'page': 999999999999999999999}, {'size': 101},
    {'hours_back': 0}, {'hours_back': 169}])
def test_invalid_scope(context, changes):
    client = context[0]
    assert read(client, selected(client), **changes).status_code == 422


@pytest.mark.parametrize('position', [0, -1, 601, 999999999999999999999999])
def test_invalid_position(context, position):
    group = selected(context[0])
    group['position'] = position
    assert read(context[0], group).status_code == 422



def test_real_authentication_rejects_inactive_and_anonymous_reads(client):
    h = _register_and_login(client, 'candidate-auth@example.com')
    path = '/api/v1/cases/triage-correlation/1/members'
    params = {'membership': 'a' * 64}
    assert client.get(path, headers=h, params=params).status_code == 409
    with _TestingSessionLocal() as db:
        db.query(User).filter(User.email == 'candidate-auth@example.com').one().is_active = False
        db.commit()
    assert client.get(path, headers=h, params=params).status_code == 403
    client.cookies.clear()
    assert client.get(path, params=params).status_code == 401
