"""Shared selection rules for automatic triage and its read-only intake preview."""
from datetime import UTC, datetime

from sqlalchemy import func, select

from backend.models.alert import Alert
from backend.models.case import Case, CaseAlert, CaseEvent
from backend.models.security_event import SecurityEvent

ALERT_BATCH_LIMIT = 100
EVENT_BATCH_LIMIT = 500


def triage_predicates(user_id, cutoff, kind, until=None):
    model, link, reference = (Alert, CaseAlert, CaseAlert.alert_id) if kind == 'alert' else (
        SecurityEvent, CaseEvent, CaseEvent.event_id)
    linked = select(link.id).join(Case, Case.id == link.case_id).where(
        reference == model.id, Case.user_id == user_id,
    ).exists()
    timestamp = model.created_at if kind == 'alert' else model.timestamp
    predicates = [model.user_id == user_id, timestamp >= cutoff,
                  timestamp <= (until or datetime.now(UTC)), ~linked]
    if kind == 'event':
        predicates.append(SecurityEvent.processed == 'pending')
    return predicates


async def intake_preview(db, user_id, cutoff, kind, until=None):
    model = Alert if kind == 'alert' else SecurityEvent
    timestamp = model.created_at if kind == 'alert' else model.timestamp
    limit = ALERT_BATCH_LIMIT if kind == 'alert' else EVENT_BATCH_LIMIT
    predicates = triage_predicates(user_id, cutoff, kind, until=until)
    total = (await db.execute(select(func.count()).select_from(model).where(*predicates))).scalar_one()
    label = model.title if kind == 'alert' else model.signature
    rows = (await db.execute(select(model.id, label, model.severity, timestamp).where(*predicates)
                            .order_by(timestamp.desc(), model.id.desc()).limit(10))).all()
    return {'eligible_count': total, 'batch_limit': limit, 'batch_count': min(total, limit),
            'deferred_count': max(0, total - limit), 'sample_limit': 10,
            'sample': [{'id': identity, 'label': label,
                        'severity': severity.value if hasattr(severity, 'value') else severity,
                        'recorded_at': recorded_at}
                       for identity, label, severity, recorded_at in rows]}
