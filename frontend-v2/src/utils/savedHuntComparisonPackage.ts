import { compareRetainedHuntRows } from './compareRetainedHuntRows';
import { savedHuntEvidence, type SavedHuntSession } from './huntSessionEvidence';
interface Side { session: SavedHuntSession; queryIndex: number; readAt: string }
export function savedHuntComparisonPackage(a: Side, b: Side, selectedSet: 'shared' | 'onlyA' | 'onlyB', exportedAt: string): string {
  if (a.session.id === b.session.id || [a, b].some(side => !Number.isSafeInteger(side.session.id) || side.session.id < 1 || !Number.isSafeInteger(side.queryIndex) || side.queryIndex < 0 || !side.readAt) || !exportedAt) throw Error('Both exact saved reads and selected query indexes are required for a comparison download.');
  const queries = [a, b].map(value => savedHuntEvidence(value.session, value.session.id).evidence.query_results?.[value.queryIndex]);
  if (!queries[0] || !queries[1]) throw Error('Both selected saved query results are required. No file was saved.');
  const compared = compareRetainedHuntRows(queries[0], queries[1]);
  const side = (value: Side, query: NonNullable<typeof queries[number]>) => ({ session_id: value.session.id, hypothesis: value.session.hypothesis,
    recorded_status: value.session.status, session_created_at: value.session.created_at,
    session_reported_findings: value.session.findings_count, read_at: value.readAt, query_index: value.queryIndex + 1,
    query_result: { query: query.query, execution: query.execution, time_window: query.time_window,
      outcome: query.outcome, error: query.error, row_count: query.row_count, rows: query.rows } });
  return JSON.stringify({ format: 'onealert_saved_hunt_comparison_v1', exported_at: exportedAt,
    scope: 'Exact loaded retained-query row comparison, not a new hunt, AI call or proof of a threat or change in security posture. '
      + 'Source reads are separate mutable saved records, not an atomic or immutable historical version. '
      + 'Only the two selected query results are included, not all queries, unretained reported rows, Sigma output or linked run details. '
      + 'Both source query results and all three row sets are included irrespective of the displayed set or page. '
      + 'Duplicates count separately; object key order is ignored, array order and absent versus null values remain distinct. '
      + 'Metadata may be missing or differ. Review retained telemetry, hypotheses and query parameters before sharing. No access is granted.',
    displayed_set: selectedSet, source_a: side(a, queries[0]), source_b: side(b, queries[1]),
    same_recorded_context: compared.sameRecordedContext,
    counts: { shared: compared.shared.length, only_a: compared.onlyA.length, only_b: compared.onlyB.length },
    records: { shared: compared.shared, only_a: compared.onlyA, only_b: compared.onlyB } }, null, 2) + '\n';
}
