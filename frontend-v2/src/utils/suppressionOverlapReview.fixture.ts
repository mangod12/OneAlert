import { suppressionRuleFingerprint, type SuppressionRuleSnapshot } from './suppressionStatusReview';
import type { SuppressionOverlap } from './suppressionOverlapReview';
export async function makeSuppressionOverlap(): Promise<SuppressionOverlap> {
  const rule: SuppressionRuleSnapshot = { id: 7, name: 'Gateway 100%_ 名', cve_id: null, asset_id: 11, severity: null, title_contains: '100%_', duration_hours: 24, enabled: false, created_at: '2026-01-01T00:00:00Z' };
  const others = [{ ...rule, id: 8, name: 'Shared title policy', title_contains: 'shared', enabled: true }, { ...rule, id: 9, name: 'High severity policy', severity: 'high', enabled: true }];
  return { version: 1, scope: 'active', example_limit: 10, other_enabled_rule_limit: 200, active_alert_limit: 50000, active_alert_count: 4, rule, rule_fingerprint: await suppressionRuleFingerprint(rule), retrieved_at: '2026-11-22T18:00:00Z', other_enabled_rule_count: 2, compared_other_rule_count: 2, ignored_empty_other_rule_count: 0,
    matching_alert_count: 2, shared_matching_alert_count: 1, exclusive_matching_alert_count: 1,
    overlapping_rules: await Promise.all(others.map(async current => ({ rule: current, rule_fingerprint: await suppressionRuleFingerprint(current), matching_alert_count: 1 }))),
    examples: [{ alert: { id: 90, asset_id: 11, title: '100%_ shared example', cve_id: null, severity: 'high', status: 'pending', created_at: '2026-01-01T00:00:00Z' }, other_rule_ids: [8, 9] }, { alert: { id: 89, asset_id: 11, title: '100%_ exclusive example', cve_id: null, severity: 'low', status: 'sent', created_at: '2026-01-01T00:00:00Z' }, other_rule_ids: [] }] };
}
