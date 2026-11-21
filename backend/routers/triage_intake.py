"""Inspect triage intake without AI calls, ledger writes or case creation."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import get_async_db
from backend.models.user import User
from backend.routers.auth import get_active_user
from backend.services.agents.detect import DetectAgent
from backend.services.triage_intake import intake_preview

router = APIRouter()


@router.get('/triage-intake')
async def preview_triage_intake(
    hours_back: int = Query(24, ge=1, le=168),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=hours_back)
    return {'hours_back': hours_back, 'retrieved_at': now.isoformat(), 'cutoff': cutoff.isoformat(),
            'alerts': await intake_preview(db, current_user.id, cutoff, 'alert'),
            'events': await intake_preview(db, current_user.id, cutoff, 'event'),
            'scope': 'Owned recent records not linked to an owned investigation; events must also be pending. '
                     'Newest timestamp then highest ID first. '
                     'Each sample lists at most 10 records from the next batch. '
                     'Eligible events can still be excluded by later correlation or incident analysis. '
                     'This read does not run AI, create cases, mark records processed or reserve a batch. '
                     'Counts can change before a run. '
                     'Preview is for triage only, not the full detect-and-triage pipeline.'}


@router.get('/detection-preview')
async def preview_detection_coverage(
    hours_back: int = Query(24, ge=1, le=168),
    current_user: User = Depends(get_active_user), db: AsyncSession = Depends(get_async_db),
):
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=hours_back)
    agent = DetectAgent(db, current_user.id)
    stats = await agent._aggregate_events(cutoff, until=now)
    return {'hours_back': hours_back, 'retrieved_at': now.isoformat(), 'cutoff': cutoff.isoformat(),
            'total_events': stats['total_events'], 'alert_events': stats['alert_events'],
            'ai_eligible': stats['total_events'] > 5 and stats['alert_events'] > 0,
            'severity_distribution': stats['severity_distribution'],
            'top_sources': [{'label': label, 'count': count} for label, count in stats['top_source_ips'].items()],
            'top_ports': [{'label': str(label), 'count': count} for label, count in stats['top_dest_ports'].items()],
            'top_signatures': [{'label': label, 'count': count} for label, count in stats['top_signatures'].items()],
            'rule_findings': agent._rule_based_detection(stats)}
