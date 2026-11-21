"""Preview the actual next triage batch's candidate clusters without running AI or writes."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.agents.triage import TriageAgent
from backend.services.triage_coverage import ALERT_CONTEXT_LIMIT, EVENT_CONTEXT_LIMIT

router = APIRouter()


@router.get('/triage-correlation')
async def preview_triage_correlation(
    hours_back: int = Query(72, ge=1, le=168), page: int = Query(1, ge=1),
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
        records.append({'position': index, 'basis': 'shared_asset' if alert_count else 'shared_ip_component',
                        'alert_count': alert_count, 'event_count': event_count,
                        'alert_ai_input_count': min(alert_count, ALERT_CONTEXT_LIMIT),
                        'event_ai_input_count': min(event_count, EVENT_CONTEXT_LIMIT),
                        'alert_sample': sample(group['alerts'], 'alert', 3),
                        'event_sample': sample(group['events'], 'event', 5)})
    return {'hours_back': hours_back, 'cutoff': cutoff.isoformat(), 'retrieved_at': until.isoformat(),
            'page': page, 'size': 10, 'groups_total': len(groups), 'alerts_selected': len(alerts),
            'events_selected': len(events), 'events_excluded_info_only': len(events) - grouped_events,
            'records': records}
