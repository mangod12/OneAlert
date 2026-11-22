import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { suppressionEditFixture } from './suppressionEditReview.fixture';
import { buildSuppressionEditProposal, checkedSuppressionEditBase, checkedSuppressionEditPreview, checkedSuppressionEditProposal, checkedSuppressionEditResult, suppressionEditFields } from './suppressionEditReview';
import { suppressionRuleFingerprint } from './suppressionStatusReview';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('verifies the full before/proposed bindings, reconciled disjoint delta and exact conditional result while projecting raw metadata away', async () => {
  const fixture = await suppressionEditFixture(), base = await checkedSuppressionEditBase(fixture.base, 7);
  const review = await checkedSuppressionEditPreview(fixture.preview, base, fixture.proposal);
  expect(review.beforeCount).toBe(2); expect(review.afterCount).toBe(2); expect(review.counts).toEqual({ retained: 1, added: 1, removed: 1 });
  expect(JSON.stringify(review)).not.toContain('NEVER_COPY'); expect(await checkedSuppressionEditResult(fixture.result, review)).toEqual(fixture.result.rule);
});
it('preserves unedited empty strings and exact literal whitespace, and normalizes only actual cleared text edits', async () => {
  const { rule } = await suppressionEditFixture({ cve_id: '', title_contains: '  Ä%_  ' });
  const fields = suppressionEditFields(rule); fields.name = 'Edited name';
  expect(buildSuppressionEditProposal(fields, rule)).toMatchObject({ name: 'Edited name', cve_id: '', title_contains: '  Ä%_  ' });
  fields.title_contains = ''; expect(buildSuppressionEditProposal(fields, rule)).toMatchObject({ cve_id: '', title_contains: null });
});
it.each(['0', '721', '1.5', '1e2', '', 'NaN', '9007199254740992'])('rejects non-whole or out-of-range snooze hours %s without coercion', async value => {
  const { rule } = await suppressionEditFixture(); expect(() => buildSuppressionEditProposal({ ...suppressionEditFields(rule), name: 'Edit', duration_hours: value }, rule)).toThrow(/whole number/);
});
it.each(['0', '-1', '1.2', '1e2', '01', '9007199254740992'])('rejects invalid exact asset ID %s', async value => {
  const { rule } = await suppressionEditFixture(); expect(() => buildSuppressionEditProposal({ ...suppressionEditFields(rule), name: 'Edit', asset_id: value }, rule)).toThrow(/asset ID/);
});
it('rejects no-ops, unknown/immutable keys, blank names and clearing all criteria', async () => {
  const { rule, proposal } = await suppressionEditFixture();
  expect(() => buildSuppressionEditProposal(suppressionEditFields(rule), rule)).toThrow(/at least one saved value/);
  for (const change of [{ enabled: true }, { id: 8 }, { user_id: 2 }, { name: ' ' }, { asset_id: null, cve_id: null, severity: null, title_contains: null }, { duration_hours: true }]) expect(() => checkedSuppressionEditProposal({ ...proposal, ...change }, rule)).toThrow();
});
it.each(['hash', 'wrong ID', 'missing field', 'unknown saved field', 'version', 'time'])('rejects an invalid saved read: %s', async mode => {
  const fixture = await suppressionEditFixture(); const raw = structuredClone(fixture.base) as unknown as Record<string, unknown>;
  if (mode === 'hash') raw.rule_fingerprint = '0'.repeat(64);
  if (mode === 'wrong ID') raw.rule = { ...fixture.rule, id: 8 };
  if (mode === 'missing field') { const value = { ...fixture.rule } as Partial<typeof fixture.rule>; delete value.title_contains; raw.rule = value; }
  if (mode === 'unknown saved field') raw.rule = { ...fixture.rule, private_notes: 'Do not use' };
  if (mode === 'version') raw.version = 2;
  if (mode === 'time') raw.retrieved_at = 'yesterday';
  await expect(checkedSuppressionEditBase(raw, 7)).rejects.toThrow();
});
it.each(['old hash', 'proposal hash', 'changed enabled', 'changed creation', 'changed draft', 'scope', 'bound', 'example bound', 'above cap', 'active too small', 'negative', 'unreconciled', 'sample missing', 'duplicate across groups', 'sample status', 'sample order', 'unknown group'])('refuses an inconsistent preview: %s', async mode => {
  const fixture = await suppressionEditFixture(), raw = structuredClone(fixture.preview), base = await checkedSuppressionEditBase(fixture.base, 7);
  if (mode === 'old hash') raw.rule_fingerprint = '0'.repeat(64);
  if (mode === 'proposal hash') raw.proposed_rule_fingerprint = '0'.repeat(64);
  if (mode === 'changed enabled') raw.proposed_rule.enabled = true;
  if (mode === 'changed creation') raw.proposed_rule.created_at = '2026-01-02T00:00:00Z';
  if (mode === 'changed draft') raw.proposed_rule.title_contains = 'Different proposed text';
  if (['changed enabled', 'changed creation', 'changed draft'].includes(mode)) raw.proposed_rule_fingerprint = await suppressionRuleFingerprint(raw.proposed_rule);
  if (mode === 'scope') raw.scope = 'all';
  if (mode === 'bound') raw.active_alert_limit = 50001;
  if (mode === 'example bound') raw.example_limit = 11;
  if (mode === 'above cap') raw.active_alert_count = 50001;
  if (mode === 'active too small') raw.active_alert_count = 2;
  if (mode === 'negative') raw.counts.added = -1;
  if (mode === 'unreconciled') raw.before_count = 3;
  if (mode === 'sample missing') raw.examples.added = [];
  if (mode === 'duplicate across groups') raw.examples.added[0].id = raw.examples.retained[0].id;
  if (mode === 'sample status') raw.examples.removed[0].status = 'resolved';
  if (mode === 'sample order') { raw.counts.retained = 2; raw.before_count = raw.after_count = 3; raw.active_alert_count = 4; raw.examples.retained.push({ ...raw.examples.retained[0], id: 94 }); }
  if (mode === 'unknown group') Object.assign(raw.examples, { unexpected: [] });
  await expect(checkedSuppressionEditPreview(raw, base, fixture.proposal)).rejects.toThrow();
});
it('binds preview to the exact initial saved read even when a changed saved rule has a valid replacement hash', async () => {
  const fixture = await suppressionEditFixture(), base = await checkedSuppressionEditBase(fixture.base, 7);
  fixture.preview.rule = { ...fixture.rule, name: 'Other current name' }; fixture.preview.rule_fingerprint = await suppressionRuleFingerprint(fixture.preview.rule);
  await expect(checkedSuppressionEditPreview(fixture.preview, base, fixture.proposal)).rejects.toThrow();
});
it.each(['not conditional', 'wrong reviewed hash', 'wrong result hash', 'unreviewed criterion', 'changed enabled', 'changed identity'])('does not report an unverified mutation result: %s', async mode => {
  const fixture = await suppressionEditFixture(), base = await checkedSuppressionEditBase(fixture.base, 7), review = await checkedSuppressionEditPreview(fixture.preview, base, fixture.proposal), result = structuredClone(fixture.result);
  if (mode === 'not conditional') result.conditional_update_applied = false;
  if (mode === 'wrong reviewed hash') result.reviewed_fingerprint = '0'.repeat(64);
  if (mode === 'wrong result hash') result.rule_fingerprint = '0'.repeat(64);
  if (mode === 'unreviewed criterion') result.rule.title_contains = 'Not reviewed';
  if (mode === 'changed enabled') result.rule.enabled = true;
  if (mode === 'changed identity') result.rule.id = 8;
  if (['unreviewed criterion', 'changed enabled', 'changed identity'].includes(mode)) result.rule_fingerprint = await suppressionRuleFingerprint(result.rule);
  await expect(checkedSuppressionEditResult(result, review)).rejects.toThrow();
});
it('fails closed when independent secure hashing is unavailable', async () => {
  const fixture = await suppressionEditFixture(); vi.stubGlobal('crypto', {}); await expect(checkedSuppressionEditBase(fixture.base, 7)).rejects.toThrow();
});
