import { suppressionRuleFingerprint, type SuppressionRuleSnapshot } from './suppressionStatusReview';
import { suppressionEditKeys, type SuppressionEditProposal } from './suppressionEditReview';
export async function suppressionEditFixture(overrides: Partial<SuppressionRuleSnapshot> = {}) {
  const rule: SuppressionRuleSnapshot = { id: 7, name: 'Plant gateway 名 <script>', cve_id: null, asset_id: 11, severity: 'high', title_contains: 'old Ä%_', duration_hours: 24, enabled: false, created_at: '2026-01-01T00:00:00.123456Z', ...overrides };
  const proposal = Object.fromEntries(suppressionEditKeys.map(key => [key, key === 'title_contains' ? 'new Ä%_' : rule[key]])) as SuppressionEditProposal;
  const proposed = { ...rule, ...proposal }, stamp = '2026-11-22T18:00:00Z';
  const base = { version: 1, rule, rule_fingerprint: await suppressionRuleFingerprint(rule), retrieved_at: stamp };
  const alert = (id: number, title: string) => ({ id, asset_id: 11, title, cve_id: null, severity: 'high', status: 'pending', created_at: stamp, private_metadata: 'NEVER_COPY_RAW' });
  const preview = { ...base, scope: 'active', active_alert_limit: 50000, example_limit: 10, active_alert_count: 3,
    proposed_rule: proposed, proposed_rule_fingerprint: await suppressionRuleFingerprint(proposed),
    before_count: 2, after_count: 2, counts: { retained: 1, added: 1, removed: 1 },
    examples: { retained: [alert(93, 'old Ä%_ and new Ä%_')], added: [alert(92, 'new Ä%_ only')], removed: [alert(91, 'old Ä%_ only')] }, private_metadata: 'NEVER_COPY_TOP' };
  const result = { conditional_update_applied: true, reviewed_fingerprint: base.rule_fingerprint, rule: proposed, rule_fingerprint: preview.proposed_rule_fingerprint };
  return { rule, proposal, base, preview, result };
}
