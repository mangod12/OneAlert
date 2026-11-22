export interface SuppressionRuleSnapshot {
  id: number; name: string; cve_id: string | null; asset_id: number | null;
  severity: string | null; title_contains: string | null; duration_hours: number;
  enabled: boolean; created_at: string;
}
export interface SuppressionReview {
  rule: SuppressionRuleSnapshot; fingerprint: string; total: number; retrievedAt: string;
  criteriaPresent: boolean;
  alerts: { id: number; asset_id: number | null; title: string; cve_id: string | null; severity: string; status: string; created_at: string }[];
}
export const suppressionRuleKeys = ['asset_id', 'created_at', 'cve_id', 'duration_hours', 'enabled', 'id', 'name', 'severity', 'title_contains'] as const;
const failure = () => Error('The current rule and its review binding could not be verified. No status request was sent.');
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown, limit = 16384): value is string => typeof value === 'string' && value.length <= limit && !/[\uD800-\uDFFF]/u.test(value);
const date = (value: unknown): value is string => text(value, 100) && value.includes('T') && !Number.isNaN(Date.parse(value));
export const suppressionCriteriaPresent = (rule: SuppressionRuleSnapshot) => [rule.cve_id, rule.asset_id, rule.severity, rule.title_contains].some(value => value !== null && value !== '');
export function checkedSuppressionRule(value: unknown, identity: number): SuppressionRuleSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== suppressionRuleKeys.length || suppressionRuleKeys.some(key => !Object.hasOwn(raw, key))) throw failure();
  if (!id(identity) || raw.id !== identity || !text(raw.name, 200) || raw.name.length < 1 || typeof raw.enabled !== 'boolean' || !date(raw.created_at) || !Number.isSafeInteger(raw.duration_hours) || Number(raw.duration_hours) < 1 || Number(raw.duration_hours) > 720) throw failure();
  for (const key of ['cve_id', 'title_contains'] as const) if (raw[key] !== null && !text(raw[key])) throw failure();
  if (raw.asset_id !== null && !id(raw.asset_id)) throw failure();
  if (raw.severity !== null && !['low', 'medium', 'high', 'critical'].includes(raw.severity as string)) throw failure();
  return Object.fromEntries(suppressionRuleKeys.map(key => [key, raw[key]])) as unknown as SuppressionRuleSnapshot;
}
export async function suppressionRuleFingerprint(rule: SuppressionRuleSnapshot): Promise<string> {
  const checked = checkedSuppressionRule(rule, rule.id);
  try {
    const wire = JSON.stringify(Object.fromEntries(suppressionRuleKeys.map(key => [key, checked[key]])));
    const bytes = new TextEncoder().encode('onealert_suppression_rule_status_v1\0' + wire);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw Error('Secure rule hashing is unavailable. No status request was sent. Use a browser with secure hashing support.'); }
}
export async function checkedSuppressionBinding(value: unknown, fingerprint: unknown, identity: number) {
  const rule = checkedSuppressionRule(value, identity);
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint) || await suppressionRuleFingerprint(rule) !== fingerprint) throw failure();
  return { rule, fingerprint };
}
export async function checkedSuppressionReview(value: unknown, identity: number): Promise<SuppressionReview> {
  if (!value || typeof value !== 'object') throw failure();
  const raw = value as Record<string, unknown>;
  const binding = await checkedSuppressionBinding(raw.rule, raw.rule_fingerprint, identity);
  if (raw.page !== 1 || raw.size !== 10 || raw.scope !== 'active' || raw.search !== '' || !Number.isSafeInteger(raw.total) || Number(raw.total) < 0 || raw.matching_total !== raw.total || raw.criteria_present !== suppressionCriteriaPresent(binding.rule) || !date(raw.retrieved_at) || !Array.isArray(raw.alerts) || raw.alerts.length !== Math.min(10, Number(raw.total))) throw failure();
  let previous = Infinity;
  const alerts = raw.alerts.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw failure();
    const row = item as Record<string, unknown>;
    if (!id(row.id) || Number(row.id) >= previous || row.asset_id !== null && !id(row.asset_id) || !text(row.title) || row.cve_id !== null && !text(row.cve_id) || !text(row.severity, 100) || !['pending', 'sent', 'acknowledged'].includes(row.status as string) || !date(row.created_at)) throw failure();
    previous = Number(row.id);
    return { id: Number(row.id), asset_id: row.asset_id as number | null, title: row.title, cve_id: row.cve_id as string | null, severity: row.severity, status: row.status as string, created_at: row.created_at };
  });
  return { ...binding, total: Number(raw.total), criteriaPresent: Boolean(raw.criteria_present), retrievedAt: raw.retrieved_at as string, alerts };
}
export async function checkedSuppressionStatusResult(value: unknown, review: SuppressionReview, enabled: boolean) {
  if (!value || typeof value !== 'object') throw failure();
  const raw = value as Record<string, unknown>;
  if (raw.conditional_update_applied !== true || raw.reviewed_fingerprint !== review.fingerprint) throw failure();
  const binding = await checkedSuppressionBinding(raw.rule, raw.rule_fingerprint, review.rule.id);
  if (suppressionRuleKeys.some(key => binding.rule[key] !== (key === 'enabled' ? enabled : review.rule[key]))) throw failure();
  return binding.rule;
}
