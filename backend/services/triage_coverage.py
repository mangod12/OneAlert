"""Record the exact summary-field input scope used at automatic case creation."""
ALERT_CONTEXT_LIMIT = 20
EVENT_CONTEXT_LIMIT = 50


def triage_coverage(alerts, events, method, model=None):
    alert_inputs = alerts[:ALERT_CONTEXT_LIMIT] if method == 'ai_sample' else alerts
    event_inputs = events[:EVENT_CONTEXT_LIMIT] if method == 'ai_sample' else events
    return {'version': 1, 'method': method, 'model': model if method == 'ai_sample' else None,
            'alerts_total': len(alerts), 'events_total': len(events),
            'alert_input_ids': [row.id for row in alert_inputs], 'event_input_ids': [row.id for row in event_inputs],
            'alerts_omitted': len(alerts) - len(alert_inputs), 'events_omitted': len(events) - len(event_inputs)}
