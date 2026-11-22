import { parseHuntQueryDraft, parseRefinedHuntDraft, sameHuntDraftValue as same, type DraftQuery, type HuntQueryDraft, type HuntQueryEdit } from './huntQueryDraft';

export interface DraftQueryDifference {
  position: number;
  edited: boolean;
  changes: string[];
  timeBoundChanges: string[];
  source: DraftQuery;
  refined: DraftQuery;
}
export interface HuntDraftSourceComparison {
  source: HuntQueryDraft;
  refined: HuntQueryDraft;
  queries: DraftQueryDifference[];
}

// Date.parse alone drops sub-millisecond precision. Preserve supported ISO
// fractions so a one-microsecond bound change is not called the same instant.
function exactInstant(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  return Number.isFinite(seconds) ? BigInt(seconds) * 1000000n + BigInt((match[2] ?? '').padEnd(9, '0')) : null;
}

function boundChanges(source: DraftQuery, refined: DraftQuery): string[] {
  if (!source.accepted || !refined.accepted) return ['Applied time bounds cannot be compared because at least one query is compiler-rejected.'];
  const changes: string[] = [];
  for (const key of ['since', 'before'] as const) {
    const old = source.time_window[key], current = refined.time_window[key];
    if (old === current) continue;
    if (!old) changes.push(`${key} added: ${current}. This adds an applied ${key === 'since' ? 'lower' : 'upper'} UTC bound.`);
    else if (!current) changes.push(`${key} removed. This widens that time bound; other SQL predicates may still restrict rows.`);
    else {
      const oldInstant = exactInstant(old), currentInstant = exactInstant(current);
      if (oldInstant === null || currentInstant === null) {
        changes.push(`${key} timestamp text changed: ${old} to ${current}. Exact direction was not determined for this timestamp format; review the saved values.`);
        continue;
      }
      if (oldInstant === currentInstant) {
        changes.push(`${key} uses different timestamp text for the same instant; the applied time bound did not move.`);
        continue;
      }
      const earlier = currentInstant < oldInstant;
      changes.push(`${key} moved ${earlier ? 'earlier' : 'later'}: ${old} to ${current}. This ${key === 'since' ? earlier ? 'widens' : 'narrows' : earlier ? 'narrows' : 'widens'} that time bound, not necessarily the whole query.`);
    }
  }
  return changes;
}

export function compareHuntDraftSource(refinedValue: unknown, sourceValue: unknown): HuntDraftSourceComparison {
  const refined = parseHuntQueryDraft(refinedValue), lineage = refined.draft.refinement;
  if (!lineage) throw Error('Only an analyst-refined draft has a recorded source to compare.');
  const source = parseHuntQueryDraft(sourceValue, { id: lineage.source_session_id });
  if (source.fingerprint !== lineage.source_fingerprint) throw Error('The source draft no longer matches the recorded source fingerprint. No replacement or comparison was inferred.');
  if (source.draft.queries.length !== refined.draft.queries.length) throw Error('The source and refinement do not retain the same original query positions.');
  const edits: HuntQueryEdit[] = [];
  for (const [index, query] of refined.draft.queries.entries()) {
    const original = source.draft.queries[index];
    if (query.sql !== original.sql || !same(query.params, original.params)) {
      if (query.sql === null) throw Error('An edited query has no retained SQL. Its source cannot be compared.');
      edits.push({ position: query.position, sql: query.sql, params: query.params });
    }
  }
  // Reuse the save-response contract so the recorded edited positions, copied
  // narrative, source identity and exact SQL/parameters cannot disagree.
  parseRefinedHuntDraft(refined, source, edits);
  const queries = refined.draft.queries.map((query, index) => {
    const original = source.draft.queries[index], changes: string[] = [];
    if (query.sql !== original.sql) changes.push('SQL text');
    if (!same(query.params, original.params)) changes.push('parameters');
    if (query.accepted !== original.accepted) changes.push('compiler acceptance');
    if (!same(query.execution?.selected_columns ?? null, original.execution?.selected_columns ?? null)) changes.push('selected columns');
    const order = (value: DraftQuery) => value.execution ? { column: value.execution.order_by, direction: value.execution.direction, tie_breaker: value.execution.tie_breaker } : null;
    if (!same(order(query), order(original))) changes.push('ordering');
    const limits = (value: DraftQuery) => value.execution ? { requested: value.execution.requested_limit, applied: value.execution.row_limit } : null;
    if (!same(limits(query), limits(original))) changes.push('row limits');
    if (!same(query.time_window, original.time_window)) changes.push('applied absolute time bounds');
    if (query.error !== original.error) changes.push('compiler note');
    return { position: query.position, edited: lineage.edited_query_numbers.includes(query.position), changes, timeBoundChanges: boundChanges(original, query), source: original, refined: query };
  });
  return { source, refined, queries };
}

export function huntDraftSourceComparisonPackage(value: HuntDraftSourceComparison, exportedAt: string): string {
  if (!Number.isFinite(Date.parse(exportedAt))) throw Error('A valid comparison export time is required.');
  const checked = compareHuntDraftSource(value.refined, value.source);
  return JSON.stringify({
    format: 'onealert_hunt_draft_source_comparison_v1', exported_at: exportedAt,
    ...checked,
    scope: 'Loaded compiler-only drafts, not event results. The source payload fingerprint matches the refinement lineage. Reads were made at separate times and do not form an atomic application-state snapshot. SQL is compared as text; this is not a semantic-equivalence or query-cost proof, execution approval, AI review, scan or finding. Unsaved edits and previously omitted queries are excluded. Hypotheses, SQL and parameters may be sensitive. Keep private; downloaded copies have no application access controls. No extra read or sharing occurs during export.',
  }, null, 2) + '\n';
}
