import { checkedSuppressionBinding, suppressionCriteriaPresent, type SuppressionRuleSnapshot } from './suppressionStatusReview';
export interface SuppressionOverlap {
  version: 1; scope: 'active'; example_limit: 10; other_enabled_rule_limit: 200; active_alert_limit: 50000; active_alert_count: number;
  rule: SuppressionRuleSnapshot; rule_fingerprint: string; retrieved_at: string;
  other_enabled_rule_count: number; compared_other_rule_count: number; ignored_empty_other_rule_count: number;
  matching_alert_count: number; shared_matching_alert_count: number; exclusive_matching_alert_count: number;
  overlapping_rules: { rule: SuppressionRuleSnapshot; rule_fingerprint: string; matching_alert_count: number }[];
  examples: { alert: { id: number; asset_id: number | null; title: string; cve_id: string | null; severity: string; status: string; created_at: string }; other_rule_ids: number[] }[];
}
const fail = () => Error('The overlap review could not be verified. No counts or export are available. Read it again.');
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: unknown): value is number => count(value) && value > 0;
const text = (value: unknown, limit = 16384): value is string => typeof value === 'string' && value.length <= limit && !/[\uD800-\uDFFF]/u.test(value);
const time = (value: unknown): value is string => text(value, 100) && value.includes('T') && !Number.isNaN(Date.parse(value));
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
export async function checkedSuppressionOverlap(value: unknown, ruleId: number): Promise<SuppressionOverlap> {
  const raw = object(value), binding = await checkedSuppressionBinding(raw.rule, raw.rule_fingerprint, ruleId);
  if (!suppressionCriteriaPresent(binding.rule) || raw.version !== 1 || raw.scope !== 'active' || raw.example_limit !== 10 || raw.other_enabled_rule_limit !== 200 || raw.active_alert_limit !== 50000 || !count(raw.active_alert_count) || raw.active_alert_count > 50000 || !time(raw.retrieved_at)) throw fail();
  const enabled = raw.other_enabled_rule_count, compared = raw.compared_other_rule_count, ignored = raw.ignored_empty_other_rule_count;
  const total = raw.matching_alert_count, shared = raw.shared_matching_alert_count, exclusive = raw.exclusive_matching_alert_count;
  if (!count(enabled) || enabled > 200 || !count(compared) || !count(ignored) || compared + ignored !== enabled || !count(total) || total > raw.active_alert_count || !count(shared) || !count(exclusive) || shared + exclusive !== total || !Array.isArray(raw.overlapping_rules) || raw.overlapping_rules.length > compared || !Array.isArray(raw.examples) || raw.examples.length !== Math.min(total, 10)) throw fail();
  const overlaps = await Promise.all(raw.overlapping_rules.map(async value => {
    const row = object(value), rawRule = object(row.rule); if (!identity(rawRule.id) || rawRule.id === ruleId || !identity(row.matching_alert_count) || row.matching_alert_count > shared) throw fail();
    const checked = await checkedSuppressionBinding(rawRule, row.rule_fingerprint, rawRule.id);
    if (!checked.rule.enabled || !suppressionCriteriaPresent(checked.rule)) throw fail();
    return { rule: checked.rule, rule_fingerprint: checked.fingerprint, matching_alert_count: row.matching_alert_count };
  }));
  const byRule = new Map(overlaps.map(row => [row.rule.id, row]));
  if (byRule.size !== overlaps.length || (shared === 0) !== (overlaps.length === 0) || overlaps.reduce((sum, row) => sum + row.matching_alert_count, 0) < shared) throw fail();
  for (let index = 1; index < overlaps.length; index++) { const previous = overlaps[index - 1], current = overlaps[index]; if (previous.matching_alert_count < current.matching_alert_count || previous.matching_alert_count === current.matching_alert_count && previous.rule.id >= current.rule.id) throw fail(); }
  let previousAlert = Infinity;
  const samples = new Map<number, number>();
  const examples = raw.examples.map(value => {
    const row = object(value), alert = object(row.alert);
    if (!identity(alert.id) || alert.id >= previousAlert || alert.asset_id !== null && !identity(alert.asset_id) || !text(alert.title) || alert.cve_id !== null && !text(alert.cve_id) || !text(alert.severity, 100) || !['pending', 'sent', 'acknowledged'].includes(alert.status as string) || !time(alert.created_at) || !Array.isArray(row.other_rule_ids) || row.other_rule_ids.length > overlaps.length) throw fail();
    previousAlert = alert.id; let previousRule = 0;
    const ids = row.other_rule_ids.map(value => { if (!identity(value) || value <= previousRule || !byRule.has(value)) throw fail(); previousRule = value; samples.set(value, (samples.get(value) ?? 0) + 1); return value; });
    return { alert: { id: alert.id, asset_id: alert.asset_id as number | null, title: alert.title, cve_id: alert.cve_id as string | null, severity: alert.severity, status: alert.status as string, created_at: alert.created_at }, other_rule_ids: ids };
  });
  if (examples.filter(row => row.other_rule_ids.length > 0).length > shared || examples.filter(row => row.other_rule_ids.length === 0).length > exclusive || overlaps.some(row => (samples.get(row.rule.id) ?? 0) > row.matching_alert_count)) throw fail();
  return { version: 1, scope: 'active', example_limit: 10, other_enabled_rule_limit: 200, active_alert_limit: 50000, active_alert_count: raw.active_alert_count, rule: binding.rule, rule_fingerprint: binding.fingerprint, retrieved_at: raw.retrieved_at,
    other_enabled_rule_count: enabled, compared_other_rule_count: compared, ignored_empty_other_rule_count: ignored,
    matching_alert_count: total, shared_matching_alert_count: shared, exclusive_matching_alert_count: exclusive, overlapping_rules: overlaps, examples };
}
export function suppressionOverlapPackage(review: SuppressionOverlap) {
  return { schema: 'onealert.suppression_overlap_review.v1',
    scope_note: 'Current active alert criteria overlap only. Selected rule may be paused. Other compared rules were enabled and had criteria when read.',
    limits: ['The complete review is refused above 200 other enabled rules or 50000 owned active alert rows, with no partial counts.', 'Rule records and alert rows are separate current reads, not a frozen transaction or history.', 'Examples are at most ten highest matching alert IDs, not all matching alerts.', 'Per-rule counts can overlap; shared alerts are counted once in the shared total.', 'No future volume, actual past suppression, winning rule, execution order or safe-to-pause claim.', 'Private saved criteria and alert titles are included. This file does not grant app access.'],
    review };
}
