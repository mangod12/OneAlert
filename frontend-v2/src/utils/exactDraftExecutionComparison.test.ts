import { expect, it } from 'vitest';
import { auditExactDraftExecutionPair, compareExactDraftExecutionQuery, exactDraftExecutionComparisonJson } from './exactDraftExecutionComparison';
import { exactDraftExecutionFixture as fixture } from './exactDraftExecutionComparison.fixture';
import type { HuntEvidenceResult } from './huntEvidence';
it('matches original position rather than array index when selections differ between executions', () => {
  const { source, left, right } = fixture(), first = source.draft.queries[0];
  left.result_data.reviewed_draft!.query_numbers = [1, 2];
  left.result_data.query_results!.unshift({ ...structuredClone(left.result_data.query_results![0]), query: { description: first.description, sql: first.sql!, params: first.params, reviewed_query_number: 1 } });
  left.result_data.execution_summary = { completed: 2, rejected: 0, failed: 0, attempted: 2, skipped: 0 }; left.queries_run = 2; left.findings_count = 2;
  right.result_data.query_results![0].rows = [{ id: 23 }];
  const before = structuredClone({ source, left, right }), pair = auditExactDraftExecutionPair(source, left, 81, right, 82);
  expect(pair.completedPositions).toEqual([2]); const comparison = compareExactDraftExecutionQuery(pair, 2);
  expect(comparison.rows).toMatchObject({ shared: [], onlyA: [{ id: 22 }], onlyB: [{ id: 23 }] });
  expect(comparison.source.position).toBe(2); expect({ source, left, right }).toEqual(before);
  expect(() => compareExactDraftExecutionQuery(pair, 1)).toThrow();
});
it.each(['same', 'source', 'missing', 'wrong_record', 'too_large', 'fraction'])('refuses invalid or mismatched exact saved identities: %s', mode => {
  const { source, left, right } = fixture(); let leftId = 81, rightId = 82;
  if (mode === 'same') rightId = 81;
  if (mode === 'source') leftId = source.session_id;
  if (mode === 'missing') leftId = 0;
  if (mode === 'wrong_record') right.id = 83;
  if (mode === 'too_large') rightId = 2147483648;
  if (mode === 'fraction') rightId = 82.5;
  expect(() => auditExactDraftExecutionPair(source, left, leftId, right, rightId)).toThrow();
});
it.each(['fingerprint', 'source', 'sql', 'parameters', 'contract', 'outer_status', 'outer_attempted', 'outer_rows', 'interrupted', 'disjoint', 'missing_rows', 'embedded_id', 'embedded_hypothesis'])('refuses unrelated, incomplete or conflicting paired evidence: %s', mode => {
  const { source, left, right } = fixture(), data = right.result_data, query = data.query_results![0];
  if (mode === 'fingerprint') data.reviewed_draft!.fingerprint = 'f'.repeat(64);
  if (mode === 'source') data.reviewed_draft!.session_id = 8;
  if (mode === 'sql') query.query!.sql += ' ';
  if (mode === 'parameters') query.query!.params = {};
  if (mode === 'contract') query.execution!.row_limit = 3;
  if (mode === 'outer_status') right.status = 'failed';
  if (mode === 'outer_attempted') right.queries_run = 0;
  if (mode === 'outer_rows') right.findings_count = 8;
  if (mode === 'interrupted') { right.status = data.status = 'failed'; data.error = 'Interrupted'; delete data.query_results; delete data.execution_summary; right.queries_run = right.findings_count = 0; }
  if (mode === 'disjoint') { data.reviewed_draft!.query_numbers = [1]; query.query!.reviewed_query_number = 1; query.query!.description = source.draft.queries[0].description; }
  if (mode === 'missing_rows') delete query.rows;
  if (mode === 'embedded_id') data.session_id = 83;
  if (mode === 'embedded_hypothesis') data.hypothesis = 'Conflicting embedded hypothesis';
  expect(() => auditExactDraftExecutionPair(source, left, 81, right, 82)).toThrow();
});
it('keeps successfully completed empty receipts comparable without claiming missing evidence is empty', () => {
  const { source, left, right } = fixture(); right.result_data.query_results![0].rows = []; right.result_data.query_results![0].row_count = 0; right.findings_count = 0;
  const pair = auditExactDraftExecutionPair(source, left, 81, right, 82); expect(compareExactDraftExecutionQuery(pair, 2).rows.onlyA).toEqual([{ id: 22 }]);
  source.can_execute = false; source.read_at = '2026-11-23T03:10:00Z'; expect(auditExactDraftExecutionPair(source, left, 81, right, 82).source.can_execute).toBe(false);
});
it('preserves duplicate row multiplicity and null values when comparing matched completed receipts', () => {
  const { source, left, right } = fixture();
  left.result_data.query_results![0].rows = [{ id: 22 }, { id: 22 }, { id: null }]; left.result_data.query_results![0].row_count = left.findings_count = 3;
  right.result_data.query_results![0].rows = [{ id: 22 }, { id: 23 }, { id: null }]; right.result_data.query_results![0].row_count = right.findings_count = 3;
  const pair = auditExactDraftExecutionPair(source, left, 81, right, 82);
  expect(compareExactDraftExecutionQuery(pair, 2).rows).toMatchObject({ shared: [{ id: 22 }, { id: null }], onlyA: [{ id: 22 }], onlyB: [{ id: 23 }] });
  right.result_data.query_results![0].rows = [];
  expect(() => compareExactDraftExecutionQuery(pair, 2)).toThrow();
});

it('permits an absent inner session ID when the exact saved envelope supplies identity', () => {
  const { source, left, right } = fixture(); delete (left.result_data as HuntEvidenceResult).session_id; delete (right.result_data as HuntEvidenceResult).session_id;
  expect(auditExactDraftExecutionPair(source, left, 81, right, 82).completedPositions).toEqual([2]);
});

it('exports only the selected loaded query and all retained row sets, not whole sessions or unknown response fields', () => {
  const { source, left, right } = fixture();
  Object.assign(source, { private_extra: 'source secret' }); Object.assign(source.draft.queries[1], { private_extra: 'query secret' });
  Object.assign(left.result_data, { private_extra: 'other result secret' }); Object.assign(left.result_data.query_results![0], { private_extra: 'receipt secret' });
  right.result_data.query_results![0].rows = [{ id: 23 }];
  const pair = auditExactDraftExecutionPair(source, left, 81, right, 82), before = structuredClone(pair);
  const text = exactDraftExecutionComparisonJson(pair, 2, { left: '2026-11-22T03:21:00Z', right: '2026-11-22T03:21:01Z' }, '2026-11-22T03:22:00Z'), value = JSON.parse(text);
  expect(value.format).toBe('onealert_exact_draft_execution_comparison_v1'); expect(value.selected_source_query.position).toBe(2);
  expect(value.left).toMatchObject({ session_id: 81, original_query_number: 2, rows: [{ id: 22 }] }); expect(value.right.rows).toEqual([{ id: 23 }]);
  expect(value.retained_row_sets).toEqual({ shared: [], only_left: [{ id: 22 }], only_right: [{ id: 23 }] });
  expect(value.source.queries).toBeUndefined(); expect(value.left.result_data).toBeUndefined(); expect(text).not.toContain('secret');
  expect(value.scope).toContain('Keep private'); expect(value.scope).toContain('not atomic'); expect(pair).toEqual(before);
});
it.each(['left_time', 'right_time', 'export_time', 'position', 'altered_receipt'])('revalidates loaded evidence and exact export scope: %s', mode => {
  const { source, left, right } = fixture(), pair = auditExactDraftExecutionPair(source, left, 81, right, 82);
  if (mode === 'altered_receipt') right.result_data.query_results![0].query!.sql = 'Changed';
  expect(() => exactDraftExecutionComparisonJson(pair, mode === 'position' ? 1 : 2, { left: mode === 'left_time' ? 'bad' : '2026-11-22T03:21:00Z', right: mode === 'right_time' ? '2026-11-22T03:21:00' : '2026-11-22T03:21:01Z' }, mode === 'export_time' ? 'bad' : '2026-11-22T03:22:00Z')).toThrow();
});
it('does not trust stale derived audit metadata when exporting revalidated saved records', () => {
  const { source, left, right } = fixture(), pair = auditExactDraftExecutionPair(source, left, 81, right, 82);
  pair.left.audit.result.status = 'stale injected status';
  const value = JSON.parse(exactDraftExecutionComparisonJson(pair, 2, { left: '2026-11-22T03:21:00Z', right: '2026-11-22T03:21:01Z' }, '2026-11-22T03:22:00Z'));
  expect(value.left.recorded_status).toBe('completed');
});

it('compares the common completed position in a partial session without treating its failed position as empty success', () => {
  const { source, left, right } = fixture(), first = source.draft.queries[0];
  left.result_data.reviewed_draft!.query_numbers = [1, 2]; left.status = left.result_data.status = 'partial';
  left.result_data.query_results!.unshift({ outcome: 'failed', query: { description: first.description, sql: first.sql!, params: first.params, reviewed_query_number: 1 }, rows: [], error: 'Database interruption' });
  left.result_data.execution_summary = { completed: 1, failed: 1, rejected: 0, attempted: 2, skipped: 0 }; left.queries_run = 2;
  const pair = auditExactDraftExecutionPair(source, left, 81, right, 82); expect(pair.completedPositions).toEqual([2]);
  expect(() => compareExactDraftExecutionQuery(pair, 1)).toThrow(); expect(compareExactDraftExecutionQuery(pair, 2).rows.shared).toEqual([{ id: 22 }]);
});
it('excludes another selected query and its telemetry from the selected-query comparison download', () => {
  const { source, left, right } = fixture(), first = source.draft.queries[0];
  left.result_data.reviewed_draft!.query_numbers = [1, 2]; left.result_data.query_results!.unshift({ ...structuredClone(left.result_data.query_results![0]), query: { description: first.description, sql: first.sql!, params: first.params, reviewed_query_number: 1 }, rows: [{ id: 11111111 }] });
  left.result_data.execution_summary = { completed: 2, rejected: 0, failed: 0, attempted: 2, skipped: 0 }; left.queries_run = 2; left.findings_count = 2;
  const pair = auditExactDraftExecutionPair(source, left, 81, right, 82), text = exactDraftExecutionComparisonJson(pair, 2, { left: '2026-11-22T03:21:00Z', right: '2026-11-22T03:21:01Z' }, '2026-11-22T03:22:00Z');
  expect(text).not.toContain('11111111'); expect(text).not.toContain('Original query 1'); expect(JSON.parse(text).left.rows).toEqual([{ id: 22 }]);
});
