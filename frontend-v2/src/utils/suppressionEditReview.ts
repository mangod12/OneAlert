import { checkedSuppressionBinding, checkedSuppressionRule, suppressionCriteriaPresent, suppressionRuleKeys, type SuppressionRuleSnapshot } from './suppressionStatusReview';

export const suppressionEditKeys = ['name', 'cve_id', 'asset_id', 'severity', 'title_contains', 'duration_hours'] as const;
export type SuppressionEditProposal = Pick<SuppressionRuleSnapshot, typeof suppressionEditKeys[number]>;
export type SuppressionEditFields = Record<typeof suppressionEditKeys[number], string>;
export interface SuppressionEditBase { rule: SuppressionRuleSnapshot; fingerprint: string; retrievedAt: string }
export const suppressionEditBuckets = ['retained', 'added', 'removed'] as const;
export type SuppressionEditBucket = typeof suppressionEditBuckets[number];
export interface SuppressionEditAlert { id: number; asset_id: number | null; title: string; cve_id: string | null; severity: string; status: string; created_at: string }
export interface SuppressionEditPreview extends SuppressionEditBase {
  proposal: SuppressionEditProposal; proposed: SuppressionRuleSnapshot; proposedFingerprint: string;
  activeCount: number; beforeCount: number; afterCount: number;
  counts: Record<SuppressionEditBucket, number>; examples: Record<SuppressionEditBucket, SuppressionEditAlert[]>;
}
const fail = () => Error('The saved rule edit and current match evidence could not be verified. No edit request was sent.');
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: unknown): value is number => count(value) && value > 0;
const text = (value: unknown, limit = 16384): value is string => typeof value === 'string' && value.length <= limit && !/[\uD800-\uDFFF]/u.test(value);
const time = (value: unknown): value is string => text(value, 100) && value.includes('T') && !Number.isNaN(Date.parse(value));
export function suppressionEditFields(rule: SuppressionRuleSnapshot): SuppressionEditFields {
  return Object.fromEntries(suppressionEditKeys.map(key => [key, String(rule[key] ?? '')])) as SuppressionEditFields;
}
export function checkedSuppressionEditProposal(value: unknown, rule: SuppressionRuleSnapshot): SuppressionEditProposal {
  const raw = object(value);
  if (Object.keys(raw).length !== suppressionEditKeys.length || suppressionEditKeys.some(key => !Object.hasOwn(raw, key))) throw fail();
  let proposed: SuppressionRuleSnapshot;
  try { proposed = checkedSuppressionRule({ ...rule, ...raw }, rule.id); }
  catch { throw Error('Use valid rule text, an exact asset ID, a supported severity and a whole snooze window from 1 to 720 hours.'); }
  if (!proposed.name.trim() || !suppressionCriteriaPresent(proposed)) throw Error('Use a nonblank name and at least one criterion. Literal criterion spaces are preserved.');
  if (suppressionEditKeys.every(key => proposed[key] === rule[key])) throw Error('Change at least one saved value before previewing the edit.');
  return Object.fromEntries(suppressionEditKeys.map(key => [key, proposed[key]])) as SuppressionEditProposal;
}
export function buildSuppressionEditProposal(fields: SuppressionEditFields, rule: SuppressionRuleSnapshot): SuppressionEditProposal {
  const original = suppressionEditFields(rule);
  if (!/^[0-9]+$/.test(fields.duration_hours) || !Number.isSafeInteger(Number(fields.duration_hours)) || Number(fields.duration_hours) < 1 || Number(fields.duration_hours) > 720) throw Error('Snooze hours must be a whole number from 1 to 720.');
  if (fields.asset_id !== '' && (!/^[1-9][0-9]*$/.test(fields.asset_id) || !identity(Number(fields.asset_id)))) throw Error('Use an exact positive whole-number asset ID, or leave it empty for any asset.');
  const nullable = (key: 'cve_id' | 'severity' | 'title_contains') => fields[key] === original[key] ? rule[key] : fields[key] === '' ? null : fields[key];
  return checkedSuppressionEditProposal({ name: fields.name, cve_id: nullable('cve_id'), asset_id: fields.asset_id === '' ? null : Number(fields.asset_id), severity: nullable('severity'), title_contains: nullable('title_contains'), duration_hours: Number(fields.duration_hours) }, rule);
}
export async function checkedSuppressionEditBase(value: unknown, ruleId: number): Promise<SuppressionEditBase> {
  const raw = object(value), binding = await checkedSuppressionBinding(raw.rule, raw.rule_fingerprint, ruleId);
  if (raw.version !== 1 || !time(raw.retrieved_at)) throw fail();
  return { ...binding, retrievedAt: raw.retrieved_at };
}
export async function checkedSuppressionEditPreview(value: unknown, base: SuppressionEditBase, proposal: SuppressionEditProposal): Promise<SuppressionEditPreview> {
  const raw = object(value), original = await checkedSuppressionEditBase(value, base.rule.id);
  if (original.fingerprint !== base.fingerprint) throw fail();
  const checkedProposal = checkedSuppressionEditProposal(proposal, base.rule);
  const proposed = await checkedSuppressionBinding(raw.proposed_rule, raw.proposed_rule_fingerprint, base.rule.id);
  const expected = { ...base.rule, ...checkedProposal };
  if (suppressionRuleKeys.some(key => proposed.rule[key] !== expected[key])) throw fail();
  if (raw.scope !== 'active' || raw.active_alert_limit !== 50000 || raw.example_limit !== 10 || !count(raw.active_alert_count) || raw.active_alert_count > 50000 || !count(raw.before_count) || !count(raw.after_count)) throw fail();
  const totals = object(raw.counts), groups = object(raw.examples);
  if (Object.keys(totals).length !== 3 || Object.keys(groups).length !== 3 || suppressionEditBuckets.some(key => !count(totals[key]))) throw fail();
  const counts = Object.fromEntries(suppressionEditBuckets.map(key => [key, totals[key]])) as Record<SuppressionEditBucket, number>;
  if (counts.retained + counts.removed !== raw.before_count || counts.retained + counts.added !== raw.after_count || counts.retained + counts.removed + counts.added > raw.active_alert_count) throw fail();
  if (!suppressionCriteriaPresent(base.rule) && raw.before_count !== 0) throw fail();
  const seen = new Set<number>();
  const examples = Object.fromEntries(suppressionEditBuckets.map(key => {
    const rows = groups[key]; if (!Array.isArray(rows) || rows.length !== Math.min(10, counts[key])) throw fail();
    let previous = Infinity;
    return [key, rows.map(value => {
      const row = object(value);
      if (!identity(row.id) || row.id >= previous || seen.has(row.id) || row.asset_id !== null && !identity(row.asset_id) || !text(row.title) || row.cve_id !== null && !text(row.cve_id) || !text(row.severity, 100) || !['pending', 'sent', 'acknowledged'].includes(row.status as string) || !time(row.created_at)) throw fail();
      previous = row.id; seen.add(row.id);
      return { id: row.id, asset_id: row.asset_id as number | null, title: row.title, cve_id: row.cve_id as string | null, severity: row.severity, status: row.status as string, created_at: row.created_at };
    })];
  })) as Record<SuppressionEditBucket, SuppressionEditAlert[]>;
  return { ...original, proposal: checkedProposal, proposed: proposed.rule, proposedFingerprint: proposed.fingerprint, activeCount: raw.active_alert_count, beforeCount: raw.before_count, afterCount: raw.after_count, counts, examples };
}
export async function checkedSuppressionEditResult(value: unknown, review: SuppressionEditPreview): Promise<SuppressionRuleSnapshot> {
  const raw = object(value);
  if (raw.conditional_update_applied !== true || raw.reviewed_fingerprint !== review.fingerprint) throw fail();
  const binding = await checkedSuppressionBinding(raw.rule, raw.rule_fingerprint, review.rule.id);
  if (binding.fingerprint !== review.proposedFingerprint || suppressionRuleKeys.some(key => binding.rule[key] !== review.proposed[key])) throw fail();
  return binding.rule;
}
