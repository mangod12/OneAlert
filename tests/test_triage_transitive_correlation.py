"""Saved IP overlap is transitive, bounded and separate from alert asset identity."""
from itertools import permutations
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.main import app  # noqa: F401
from backend.services.agents.triage import TriageAgent


def event(identity, source=None, destination=None, severity='high'):
    return SimpleNamespace(id=identity, source_ip=source, dest_ip=destination, severity=severity)


def test_late_bridge_connects_both_clusters_in_every_input_order_without_duplicate_evidence():
    records = [event(1, '10.0.0.1', '10.0.0.2'), event(2, '10.0.0.3', '10.0.0.4'),
               event(3, '10.0.0.2', '10.0.0.3')]
    agent = TriageAgent(MagicMock(), 1)
    for ordered in permutations(records):
        groups = agent._group_by_correlation([], list(ordered))
        assert len(groups) == 1
        assert [row.id for row in groups[0]['events']] == [row.id for row in ordered]
        assert groups[0]['ips'] == {'10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'}


def test_indirect_bridge_chain_reaches_one_component_but_disconnected_evidence_stays_separate():
    records = [event(1, 'a', 'b'), event(2, 'c', 'd'), event(3, 'e', 'f'),
               event(4, 'b', 'c'), event(5, 'd', 'e'), event(6, 'z', 'y')]
    groups = TriageAgent(MagicMock(), 1)._group_by_correlation([], records)
    assert [[row.id for row in group['events']] for group in groups] == [[1, 2, 3, 4, 5], [6]]


def test_asset_and_ip_namespaces_do_not_collide_and_missing_addresses_do_not_correlate():
    alerts = [SimpleNamespace(id=1, asset_id=7), SimpleNamespace(id=2, asset_id=7),
              SimpleNamespace(id=3, asset_id=8)]
    records = [event(1, 'asset_7'), event(2), event(3), event(4, 'event_2')]
    groups = TriageAgent(MagicMock(), 1)._group_by_correlation(alerts, records)
    assert [[row.id for row in group['alerts']] for group in groups[:2]] == [[1, 2], [3]]
    assert all(not group['events'] for group in groups[:2])
    assert [[row.id for row in group['events']] for group in groups[2:]] == [[1], [2], [3], [4]]


def test_info_bridge_is_retained_with_high_evidence_and_info_only_component_is_excluded():
    records = [event(1, 'a', 'b'), event(2, 'c', 'd'), event(3, 'b', 'c', 'info'),
               event(4, 'x', 'y', 'info')]
    groups = TriageAgent(MagicMock(), 1)._group_by_correlation([], records)
    assert [[row.id for row in group['events']] for group in groups] == [[1, 2, 3]]


def test_full_event_batch_chain_is_iterative_and_stable():
    records = [event(index, str(index), str(index + 1)) for index in range(500)]
    groups = TriageAgent(MagicMock(), 1)._group_by_correlation([], records)
    assert len(groups) == 1 and groups[0]['events'] == records and len(groups[0]['ips']) == 501


@pytest.mark.asyncio
async def test_triage_analyzes_each_complete_component_once_and_counts_its_evidence():
    records = [event(1, 'a', 'b'), event(2, 'c', 'd'), event(3, 'b', 'c')]
    agent = TriageAgent(MagicMock(), 1)
    agent._get_untriaged_alerts = AsyncMock(return_value=[])
    agent._get_untriaged_events = AsyncMock(return_value=records)
    agent._analyze_and_create_case = AsyncMock(return_value=object())
    result = await agent.run()
    agent._analyze_and_create_case.assert_awaited_once()
    assert agent._analyze_and_create_case.call_args.args[0]['events'] == records
    assert result['groups_total'] == result['cases_created'] == 1 and result['events_triaged'] == 3
