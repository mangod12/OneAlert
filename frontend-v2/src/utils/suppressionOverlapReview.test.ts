import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkedSuppressionOverlap, suppressionOverlapPackage } from './suppressionOverlapReview';
import { makeSuppressionOverlap } from './suppressionOverlapReview.fixture';
import { suppressionRuleFingerprint } from './suppressionStatusReview';
beforeEach(() => vi.stubGlobal('crypto', webcrypto)); afterEach(() => vi.unstubAllGlobals());
it('verifies complete saved rule bindings, non-additive rule counts and bounded current examples', async () => {
  const raw = await makeSuppressionOverlap(); expect(await checkedSuppressionOverlap(raw, 7)).toEqual(raw);
  expect(raw.overlapping_rules.reduce((sum, row) => sum + row.matching_alert_count, 0)).toBe(2); expect(raw.shared_matching_alert_count).toBe(1);
});
it.each(['version', 'scope', 'example_limit', 'other_enabled_rule_limit', 'time', 'enabled bound', 'compared count', 'ignored count', 'total', 'shared count', 'exclusive count', 'negative count', 'active bound', 'active count', 'active denominator', 'missing examples'])('rejects wrong scope, bounds or non-reconciling counts: %s', async mode => {
  const data = await makeSuppressionOverlap(); const raw = data as unknown as Record<string, unknown>;
  if (mode === 'version') raw.version = 2;
  if (mode === 'scope') raw.scope = 'all';
  if (mode === 'example_limit') raw.example_limit = 100;
  if (mode === 'other_enabled_rule_limit') raw.other_enabled_rule_limit = 1000;
  if (mode === 'time') raw.retrieved_at = 'bad';
  if (mode === 'enabled bound') raw.other_enabled_rule_count = 201;
  if (mode === 'compared count') raw.compared_other_rule_count = 3;
  if (mode === 'ignored count') raw.ignored_empty_other_rule_count = 1;
  if (mode === 'total') raw.matching_alert_count = 3;
  if (mode === 'shared count') raw.shared_matching_alert_count = 3;
  if (mode === 'exclusive count') raw.exclusive_matching_alert_count = 2;
  if (mode === 'negative count') raw.shared_matching_alert_count = -1;
  if (mode === 'active bound') raw.active_alert_limit = 50001;
  if (mode === 'active count') raw.active_alert_count = 50001;
  if (mode === 'active denominator') raw.active_alert_count = 1;
  if (mode === 'missing examples') raw.examples = [];
  await expect(checkedSuppressionOverlap(raw, 7)).rejects.toThrow();
});
it.each(['selected identity', 'selected hash', 'selected empty', 'other hash', 'self comparison', 'duplicate rule', 'paused other', 'empty other', 'zero other count', 'other count exceeds shared', 'tie order', 'unknown sample rule', 'duplicate sample rule', 'sample rule order', 'duplicate alert', 'inactive alert', 'missing alert field', 'wrong sample shared total', 'wrong sample exclusive total', 'missing shared rules'])('rejects an invalid rule, binding, ordering or current example: %s', async mode => {
  const raw = await makeSuppressionOverlap();
  if (mode === 'selected identity') raw.rule.id = 8;
  if (mode === 'selected hash') raw.rule_fingerprint = 'a'.repeat(64);
  if (mode === 'selected empty') { raw.rule = { ...raw.rule, asset_id: null, cve_id: null, severity: null, title_contains: null }; raw.rule_fingerprint = await suppressionRuleFingerprint(raw.rule); }
  if (mode === 'other hash') raw.overlapping_rules[0].rule_fingerprint = 'a'.repeat(64);
  if (mode === 'self comparison') raw.overlapping_rules[0].rule.id = 7;
  if (mode === 'duplicate rule') raw.overlapping_rules[1] = structuredClone(raw.overlapping_rules[0]);
  if (mode === 'paused other') { raw.overlapping_rules[0].rule.enabled = false; raw.overlapping_rules[0].rule_fingerprint = await suppressionRuleFingerprint(raw.overlapping_rules[0].rule); }
  if (mode === 'empty other') { raw.overlapping_rules[0].rule = { ...raw.overlapping_rules[0].rule, asset_id: null, cve_id: null, severity: null, title_contains: null }; raw.overlapping_rules[0].rule_fingerprint = await suppressionRuleFingerprint(raw.overlapping_rules[0].rule); }
  if (mode === 'zero other count') raw.overlapping_rules[0].matching_alert_count = 0;
  if (mode === 'other count exceeds shared') raw.overlapping_rules[0].matching_alert_count = 2;
  if (mode === 'tie order') raw.overlapping_rules.reverse();
  if (mode === 'unknown sample rule') raw.examples[0].other_rule_ids = [999];
  if (mode === 'duplicate sample rule') raw.examples[0].other_rule_ids = [8, 8];
  if (mode === 'sample rule order') raw.examples[0].other_rule_ids = [9, 8];
  if (mode === 'duplicate alert') raw.examples[1].alert.id = 90;
  if (mode === 'inactive alert') raw.examples[0].alert.status = 'resolved';
  if (mode === 'missing alert field') (raw.examples[0].alert as unknown as Record<string, unknown>).title = null;
  if (mode === 'wrong sample shared total') raw.examples[1].other_rule_ids = [8];
  if (mode === 'wrong sample exclusive total') raw.examples[0].other_rule_ids = [];
  if (mode === 'missing shared rules') raw.overlapping_rules = [];
  await expect(checkedSuppressionOverlap(raw, 7)).rejects.toThrow();
});
it('rejects sample per-rule counts that exceed their full-set count even when shared/exclusive totals reconcile', async () => {
  const raw = await makeSuppressionOverlap(); raw.matching_alert_count = 3; raw.shared_matching_alert_count = 2; raw.examples.unshift({ ...structuredClone(raw.examples[0]), alert: { ...raw.examples[0].alert, id: 91 } });
  await expect(checkedSuppressionOverlap(raw, 7)).rejects.toThrow();
});
it('allows explicit real zeroes and zero eligible other rules, without deriving a safety promise', async () => {
  const raw = await makeSuppressionOverlap(); raw.other_enabled_rule_count = raw.compared_other_rule_count = 0; raw.shared_matching_alert_count = 0; raw.exclusive_matching_alert_count = 2; raw.overlapping_rules = []; raw.examples.forEach(row => { row.other_rule_ids = []; }); expect((await checkedSuppressionOverlap(raw, 7)).exclusive_matching_alert_count).toBe(2);
  raw.matching_alert_count = raw.exclusive_matching_alert_count = 0; raw.examples = []; expect((await checkedSuppressionOverlap(raw, 7)).matching_alert_count).toBe(0);
});
it('projects API evidence before exporting and does not borrow extra raw fields or private server metadata', async () => {
  const raw = await makeSuppressionOverlap(); Object.assign(raw, { raw_data: 'TOP_PRIVATE_MARKER', unrelated_user: 'OTHER_OWNER' }); Object.assign(raw.examples[0].alert, { raw_data: 'RAW_PRIVATE_MARKER' }); Object.assign(raw.overlapping_rules[0], { private_notes: 'NOTES_PRIVATE_MARKER' });
  const checked = await checkedSuppressionOverlap(raw, 7); const json = JSON.stringify(suppressionOverlapPackage(checked));
  expect(json).not.toContain('PRIVATE_MARKER'); expect(json).not.toContain('OTHER_OWNER'); expect(json).toContain('onealert.suppression_overlap_review.v1'); expect(json).toContain('not a frozen transaction'); expect(json).toContain('Per-rule counts can overlap'); expect(json).toContain('No future volume'); expect(JSON.parse(json).review).toEqual(checked);
});
it('fails closed when secure hashing is unavailable rather than exporting unverified criteria', async () => {
  const raw = await makeSuppressionOverlap(); vi.stubGlobal('crypto', {}); await expect(checkedSuppressionOverlap(raw, 7)).rejects.toThrow();
});
