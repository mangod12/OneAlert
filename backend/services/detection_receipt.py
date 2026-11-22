"""Bounded saved review leads, not original events or confirmed detections."""

from backend.models.case import AgentStep

RECEIPT_LIMIT = 30


def _text(value, limit):
    return str(value or '')[:limit]


def build_detection_receipt(run_id, cutoff, until, stats, rules, generated, ai_status, input_context=None):
    """Keep bounded fields with explicit omission/truncation and method labels."""
    all_findings = [('rule', finding) for finding in rules] + [('ai', finding) for finding in generated]
    findings = []
    for method, finding in all_findings[:RECEIPT_LIMIT]:
        findings.append({
            'method': method, 'title': _text(finding.get('title'), 160),
            'severity': finding.get('severity'), 'description': _text(finding.get('description'), 800),
            'affected_ips': [_text(ip, 64) for ip in finding.get('affected_ips', [])[:10]],
            'recommended_actions': [_text(action, 240) for action in finding.get('recommended_actions', [])[:5]],
        })
    return {'input_context': input_context, 'format': 'onealert-detection-review', 'version': 1, 'run_id': run_id,
            'window_from': cutoff.isoformat(), 'window_until': until.isoformat(),
            'total_events': stats['total_events'], 'alert_events': stats['alert_events'],
            'rule_count': len(rules), 'ai_count': len(generated), 'ai_status': ai_status,
            'included': len(findings), 'omitted': len(all_findings) - len(findings), 'limit': RECEIPT_LIMIT,
            'findings': findings,
            'scope': ('Saved bounded review leads from aggregated event counts, not event-level evidence. '
                      'Titles/descriptions/IPs/actions may be shortened to 160/800/64/240 characters; '
                      'at most 10 IPs and 5 suggested actions per lead. Findings are not confirmed threats, '
                      'saved alerts, proof of protocol, or executed response actions. '
                      'The window bounds timestamp filters, not an atomic database snapshot.')}


async def record_detection_receipt(agent, receipt):
    """Store the structured receipt without the generic 500-character summary cut."""
    if agent._run is None:
        return
    import json
    agent._step_count += 1
    agent.db.add(AgentStep(
        run_id=agent._run.id, step_number=agent._step_count, action='detection_review_receipt',
        input_summary='Owner-scoped event aggregates. Read the bounded receipt scope before using the leads.',
        output_summary=json.dumps(receipt, ensure_ascii=True), tool_used='bounded_detection_review', duration_ms=0))
    await agent.db.flush()
