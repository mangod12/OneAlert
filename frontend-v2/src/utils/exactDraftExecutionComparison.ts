import { auditReviewedHuntExecution } from './huntReviewedExecutionAudit';
import { parseHuntQueryDraft, type HuntQueryDraft } from './huntQueryDraft';
import { savedHuntEvidence } from './huntSessionEvidence';
import { compareRetainedHuntRows } from './compareRetainedHuntRows';
import type { HuntEvidenceResult } from './huntEvidence';

const validId = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
export function auditExactDraftExecutionPair(sourceValue: HuntQueryDraft, leftValue: unknown, leftId: number, rightValue: unknown, rightId: number) {
  const source = parseHuntQueryDraft(sourceValue);
  if (![leftId, rightId].every(validId) || leftId === rightId || [leftId, rightId].includes(source.session_id)) throw Error('Choose two distinct positive saved execution IDs, neither the source draft itself.');
  const sides = [[leftValue, leftId], [rightValue, rightId]] as const;
  const [left, right] = sides.map(([value, id]) => {
    const parsed = savedHuntEvidence(value, id), raw = parsed.session.result_data as HuntEvidenceResult | null;
    if ((raw?.session_id !== undefined && raw.session_id !== id) || (raw?.hypothesis !== undefined && raw.hypothesis !== source.hypothesis)) throw Error('Embedded saved execution identity or hypothesis conflicts with the exact requested record.');
    let audit: ReturnType<typeof auditReviewedHuntExecution>;
    try { audit = auditReviewedHuntExecution(parsed.evidence, source); }
    catch { throw Error('A saved execution did not match the loaded source identity, fingerprint, original selected positions or complete query contracts. Inspect the exact saved record; no source replacement, event SELECT or execution retry was requested.'); }
    if (!audit.completeReceipt) throw Error('One saved execution has no complete query receipt. Missing evidence is not an empty completed result.');
    const attempted = audit.result.execution_summary!.attempted;
    const rows = audit.result.query_results!.reduce((sum, query) => sum + (query.row_count ?? 0), 0);
    if (parsed.session.status !== audit.result.status || parsed.session.queries_run !== attempted || parsed.session.findings_count !== rows) throw Error('Saved session status or counts conflict with its complete execution receipt. No row comparison was inferred.');
    return { session: parsed.session, audit };
  });
  const completedPositions = left.audit.queries.filter(query => query.result?.outcome === 'completed' && right.audit.queries.some(other => other.originalPosition === query.originalPosition && other.result?.outcome === 'completed')).map(query => query.originalPosition);
  if (!completedPositions.length) throw Error('The two saved executions have no common original query with completed matched receipts. Failed, rejected or unselected queries are not empty successful results.');
  return { source, left, right, completedPositions };
}
export type ExactDraftExecutionPair = ReturnType<typeof auditExactDraftExecutionPair>;
export function compareExactDraftExecutionQuery(pair: ExactDraftExecutionPair, originalPosition: number) {
  const checked = auditExactDraftExecutionPair(pair.source, pair.left.session, pair.left.session.id, pair.right.session, pair.right.session.id);
  if (!Number.isInteger(originalPosition) || !checked.completedPositions.includes(originalPosition)) throw Error('Select an original query completed in both exact-source saved executions.');
  const left = checked.left.audit.queries.find(query => query.originalPosition === originalPosition)!.result!;
  const right = checked.right.audit.queries.find(query => query.originalPosition === originalPosition)!.result!;
  return { source: checked.source.draft.queries[originalPosition - 1], left, right, rows: compareRetainedHuntRows(left, right) };
}

export function exactDraftExecutionComparisonJson(pair: ExactDraftExecutionPair, originalPosition: number, readTimes: { left: string; right: string }, exportedAt: string) {
  if (![readTimes.left, readTimes.right, exportedAt].every(value => typeof value === 'string' && value.length <= 80 && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))) throw Error('Valid timezone-aware saved-read and export times are required.');
  const verified = auditExactDraftExecutionPair(pair.source, pair.left.session, pair.left.session.id, pair.right.session, pair.right.session.id);
  const checked = compareExactDraftExecutionQuery(verified, originalPosition), query = checked.source, applied = query.execution!;
  const window = (value: Record<string, string>) => Object.fromEntries(Object.entries(value).filter(([key]) => ['since', 'before'].includes(key)));
  const receipt = (side: ExactDraftExecutionPair['left'], selected: typeof checked.left, readAt: string) => ({
    session_id: side.session.id, recorded_status: side.audit.result.status, recorded_at: side.audit.result.recorded_at, read_at: readAt,
    original_query_number: originalPosition, outcome: selected.outcome, row_count: selected.row_count, rows: selected.rows,
  });
  return JSON.stringify({
    format: 'onealert_exact_draft_execution_comparison_v1', exported_at: exportedAt,
    source: { session_id: pair.source.session_id, fingerprint: pair.source.fingerprint, read_at: pair.source.read_at, hypothesis: pair.source.hypothesis },
    selected_source_query: { position: query.position, description: query.description, sql: query.sql,
      params: Object.fromEntries(Object.entries(query.params).filter(([key]) => ['since', 'before', 'keyword'].includes(key))),
      time_window: window(query.time_window), execution: { contract: applied.contract, selected_columns: applied.selected_columns,
        order_by: applied.order_by, direction: applied.direction, requested_limit: applied.requested_limit, row_limit: applied.row_limit,
        tie_breaker: applied.tie_breaker ? { column: applied.tie_breaker.column, direction: applied.tie_breaker.direction } : null } },
    left: receipt(verified.left, checked.left, readTimes.left), right: receipt(verified.right, checked.right, readTimes.right),
    retained_row_sets: { shared: checked.rows.shared, only_left: checked.rows.onlyA, only_right: checked.rows.onlyB },
    scope: 'Only the selected original query and its completed retained receipts from two exact-source saved executions. Other selected or omitted queries and whole saved sessions are not exported. All three retained row sets are included, not only the displayed page or set. Matching checks the loaded draft contract, not its latest live server version or cryptographic integrity. Reads are not atomic or immutable. Differences are not confirmed threats, a measured security-posture change or complete database history. Row caps, ordering and changing telemetry can affect retained sets. Includes sensitive retained telemetry, hypothesis, SQL and parameters. Keep private; downloaded copies have no application access controls. No extra read, event SELECT, provider call, source renewal, execution retry or sharing.',
  }, null, 2) + '\n';
}
