"""Bounded run-ledger receipts for outcomes, including groups with no saved case."""
import json

from backend.services.triage_coverage import ALERT_CONTEXT_LIMIT, EVENT_CONTEXT_LIMIT


def group_outcome_receipt(group, position, outcome, case_id=None, method='unavailable'):
    alerts, events = group['alerts'], group['events']
    if outcome == 'failed':
        method = 'unavailable'
    ai = method == 'ai_sample'
    analyzed = method in ('ai_sample', 'rule_based_fallback')
    receipt = {
        'version': 1, 'position': position, 'outcome': outcome, 'case_id': case_id,
        'alerts_total': len(alerts), 'events_total': len(events),
        'alert_sample_ids': [row.id for row in alerts[:3]],
        'event_sample_ids': [row.id for row in events[:5]], 'method': method,
        'alert_inputs': (min(len(alerts), ALERT_CONTEXT_LIMIT) if ai else len(alerts)) if analyzed else None,
        'event_inputs': (min(len(events), EVENT_CONTEXT_LIMIT) if ai else len(events)) if analyzed else None,
    }
    encoded = json.dumps(receipt, separators=(',', ':'))
    # The run ledger shortens summaries at 500 chars. Never silently save a
    # truncated structured receipt, even if IDs or future fields grow.
    if len(encoded) > 500:
        raise ValueError('Group outcome receipt exceeds ledger summary limit')
    return encoded
