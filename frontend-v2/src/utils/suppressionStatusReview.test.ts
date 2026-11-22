import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkedSuppressionBinding, checkedSuppressionReview, checkedSuppressionRule, checkedSuppressionStatusResult, suppressionCriteriaPresent, suppressionRuleFingerprint } from './suppressionStatusReview';
const vector = JSON.parse(readFileSync(resolve(process.cwd(), '../tests/fixtures/suppression-review-v1.json'), 'utf8'));
const rule = { ...vector.rule, enabled: true };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
async function rawReview() { return { rule, rule_fingerprint: await suppressionRuleFingerprint(rule), page: 1, size: 10, scope: 'active', search: '', total: 0, matching_total: 0, criteria_present: true, retrieved_at: '2026-01-01T00:00:00Z', alerts: [] }; }
it('matches the backend-produced shared Unicode fingerprint vector with real SHA-256', async () => {
  expect(await suppressionRuleFingerprint(vector.rule)).toBe(vector.fingerprint);
  expect((await checkedSuppressionBinding(vector.rule, vector.fingerprint, 7)).rule).toEqual(vector.rule);
  expect(await suppressionRuleFingerprint(Object.fromEntries(Object.entries(vector.rule).reverse()) as typeof rule)).toBe(vector.fingerprint);
});
it.each([null, {}, { ...rule, id: 8 }, { ...rule, enabled: 'false' }, { ...rule, asset_id: 0 }, { ...rule, duration_hours: 0 }, { ...rule, duration_hours: 721 }, { ...rule, duration_hours: 1.5 }, { ...rule, severity: 'urgent' }, { ...rule, name: '' }, { ...rule, created_at: 'bad' }, { ...rule, cve_id: 3 }, { ...rule, title_contains: {} }, { ...rule, raw_data: 'private' }])('requires every supported rule field with exact types and identity %#', value => {
  expect(() => checkedSuppressionRule(value, 7)).toThrow();
});
it('rejects altered rule values even when their fingerprint is plausible', async () => {
  await expect(checkedSuppressionBinding({ ...vector.rule, title_contains: 'different' }, vector.fingerprint, 7)).rejects.toThrow();
  await expect(checkedSuppressionBinding(vector.rule, 'a'.repeat(64), 7)).rejects.toThrow();
  await expect(checkedSuppressionBinding(vector.rule, vector.fingerprint.toUpperCase(), 7)).rejects.toThrow();
});
it('does not replace missing secure hashing with an unbound status request', async () => {
  vi.stubGlobal('crypto', {}); await expect(suppressionRuleFingerprint(rule)).rejects.toThrow('No status request');
});
it('verifies the exact active evidence query and bounded descending row IDs without borrowing raw fields', async () => {
  const raw = await rawReview(); const result = await checkedSuppressionReview(raw, 7); expect(result.total).toBe(0); expect(result.rule).toEqual(rule); expect(result.alerts).toEqual([]);
  const withAlert = { ...raw, total: 1, matching_total: 1, alerts: [{ id: 11, asset_id: 11, title: '<img src=x> 名', cve_id: null, severity: 'high', status: 'pending', created_at: '2026-01-01T00:00:00Z', raw_data: 'PRIVATE_EXTRA' }] };
  expect(JSON.stringify(await checkedSuppressionReview(withAlert, 7))).not.toContain('PRIVATE_EXTRA');
});
it.each(['page', 'size', 'scope', 'search', 'total', 'count', 'criteria', 'time', 'rows', 'id', 'status', 'order'])('fails closed for inconsistent current evidence: %s', async mode => {
  const base = await rawReview(); const row = { id: 11, asset_id: 11, title: 'Example', cve_id: null, severity: 'high', status: 'pending', created_at: '2026-01-01T00:00:00Z' };
  const raw = { ...base, total: 1, matching_total: 1, alerts: [row] };
  if (mode === 'page') raw.page = 2;
  if (mode === 'size') raw.size = 50;
  if (mode === 'scope') raw.scope = 'all';
  if (mode === 'search') raw.search = 'private';
  if (mode === 'total') raw.total = -1;
  if (mode === 'count') raw.matching_total = 2;
  if (mode === 'criteria') raw.criteria_present = false;
  if (mode === 'time') raw.retrieved_at = 'bad';
  if (mode === 'rows') raw.alerts = [];
  if (mode === 'id') raw.alerts[0].id = 0;
  if (mode === 'status') raw.alerts[0].status = 'snoozed';
  if (mode === 'order') { raw.total = raw.matching_total = 2; raw.alerts.push({ ...row, id: 12 }); }
  await expect(checkedSuppressionReview(raw, 7)).rejects.toThrow();
});
it('accepts only a conditional update response matching the captured rule and exact requested status', async () => {
  const before = await checkedSuppressionReview(await rawReview(), 7); const next = { ...rule, enabled: false };
  const response = { conditional_update_applied: true, reviewed_fingerprint: before.fingerprint, rule: next, rule_fingerprint: await suppressionRuleFingerprint(next) };
  expect(await checkedSuppressionStatusResult(response, before, false)).toEqual(next);
  for (const raw of [{ ...response, conditional_update_applied: false }, { ...response, reviewed_fingerprint: 'a'.repeat(64) }, { ...response, rule: { ...next, duration_hours: 1 } }, { ...response, rule_fingerprint: 'a'.repeat(64) }]) await expect(checkedSuppressionStatusResult(raw, before, false)).rejects.toThrow();
  const different = { ...next, name: 'A different valid saved rule' };
  await expect(checkedSuppressionStatusResult({ ...response, rule: different, rule_fingerprint: await suppressionRuleFingerprint(different) }, before, false)).rejects.toThrow();
});
it('identifies empty legacy criteria without changing their meaning or inventing a criterion', () => {
  expect(suppressionCriteriaPresent(rule)).toBe(true);
  expect(suppressionCriteriaPresent({ ...rule, cve_id: null, asset_id: null, severity: null, title_contains: '' })).toBe(false);
  expect(suppressionCriteriaPresent({ ...rule, cve_id: null, asset_id: null, severity: null, title_contains: ' ' })).toBe(true);
});
