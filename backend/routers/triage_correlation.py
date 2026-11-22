"""Preview the actual next triage batch's candidate clusters without running AI or writes."""
import hashlib
import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.agents.triage import TriageAgent
from backend.services.triage_coverage import ALERT_CONTEXT_LIMIT, EVENT_CONTEXT_LIMIT

router = APIRouter()


def membership_fingerprint(group, user_id, hours_back):
    payload = {'version': 1, 'user_id': user_id, 'hours_back': hours_back,
               'alerts': [row.id for row in group['alerts']],
               'events': [row.id for row in group['events']]}
    return hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()



@router.get('/triage-correlation')
async def preview_triage_correlation(
    hours_back: int = Query(72, ge=1, le=168), page: int = Query(1, ge=1, le=2147483647),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    until = datetime.now(UTC)
    cutoff = until - timedelta(hours=hours_back)
    agent = TriageAgent(db, current_user.id)
    alerts = await agent._get_untriaged_alerts(cutoff, until=until)
    events = await agent._get_untriaged_events(cutoff, until=until)
    groups = agent._group_by_correlation(alerts, events)
    grouped_events = sum(len(group['events']) for group in groups)
    records = []
    for index, group in enumerate(groups[(page - 1) * 10:page * 10], start=(page - 1) * 10 + 1):
        alert_count, event_count = len(group['alerts']), len(group['events'])
        def sample(rows, kind, limit):
            return [{'id': row.id, 'label': row.title if kind == 'alert' else row.signature,
                     'severity': row.severity, 'recorded_at': row.created_at if kind == 'alert' else row.timestamp}
                    for row in rows[:limit]]
        records.append({'position': index,
                        'membership_fingerprint': membership_fingerprint(group, current_user.id, hours_back),
                        'basis': 'shared_asset' if alert_count else 'shared_ip_component',
                        'alert_count': alert_count, 'event_count': event_count,
                        'alert_ai_input_count': min(alert_count, ALERT_CONTEXT_LIMIT),
                        'event_ai_input_count': min(event_count, EVENT_CONTEXT_LIMIT),
                        'alert_sample': sample(group['alerts'], 'alert', 3),
                        'event_sample': sample(group['events'], 'event', 5)})
    return {'hours_back': hours_back, 'cutoff': cutoff.isoformat(), 'retrieved_at': until.isoformat(),
            'page': page, 'size': 10, 'groups_total': len(groups), 'alerts_selected': len(alerts),
            'events_selected': len(events), 'events_excluded_info_only': len(events) - grouped_events,
            'records': records}


@router.get('/triage-correlation/{position}/members')
async def preview_triage_candidate_members(
    position: int,
    membership: str = Query(..., min_length=64, max_length=64, pattern='^[0-9a-f]{64}$'),
    hours_back: int = Query(72, ge=1, le=168), page: int = Query(1, ge=1, le=2147483647),
    size: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    if not 1 <= position <= 600:
        raise HTTPException(status_code=422, detail='Candidate position must be within the bounded selected batch.')
    until = datetime.now(UTC)
    cutoff = until - timedelta(hours=hours_back)
    agent = TriageAgent(db, current_user.id)
    alerts = await agent._get_untriaged_alerts(cutoff, until=until)
    events = await agent._get_untriaged_events(cutoff, until=until)
    groups = agent._group_by_correlation(alerts, events)
    if position > len(groups):
        raise HTTPException(status_code=409, detail='Candidate selection changed. '
                                'Refresh the correlation preview before reading this group.')
    group = groups[position - 1]
    if membership_fingerprint(group, current_user.id, hours_back) != membership:
        raise HTTPException(status_code=409, detail='Candidate membership or intake order changed. '
                                'Refresh the correlation preview before reading this group.')
    records = []
    for kind, rows, limit in [('alert', group['alerts'], ALERT_CONTEXT_LIMIT),
                              ('event', group['events'], EVENT_CONTEXT_LIMIT)]:
        for index, row in enumerate(rows):
            records.append({'kind': kind, 'id': row.id, 'intake_position': index + 1,
                            'label': row.title if kind == 'alert' else row.signature,
                            'severity': row.severity,
                            'recorded_at': row.created_at if kind == 'alert' else row.timestamp,
                            'included_in_ai_context': index < limit})
    return {'position': position, 'membership_fingerprint': membership,
            'hours_back': hours_back, 'cutoff': cutoff, 'retrieved_at': until,
            'basis': 'shared_asset' if group['alerts'] else 'shared_ip_component',
            'alert_count': len(group['alerts']), 'event_count': len(group['events']),
            'alert_ai_input_count': min(len(group['alerts']), ALERT_CONTEXT_LIMIT),
            'event_ai_input_count': min(len(group['events']), EVENT_CONTEXT_LIMIT),
            'page': page, 'size': size, 'total': len(records),
            'records': records[(page - 1) * size:page * size],
            'scope': 'Current owned next-batch candidate at the selected position, guarded by the ordered '
                     'alert/event ID membership from the prior preview. A changed position, membership or '
                     'intake order requires a new preview. Metadata can change despite matching IDs. '
                     'This is not a stable group identity, reservation, saved run, complete eligible backlog '
                     'or AI review. Context flags describe current input caps only; no AI has reviewed these '
                     'records. No payloads, AI calls, ledger writes, case creation or processing changes.'}
