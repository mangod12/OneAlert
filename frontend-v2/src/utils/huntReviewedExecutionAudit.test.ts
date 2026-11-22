import { expect, it } from 'vitest';
import { auditReviewedHuntExecution, reviewedExecutionSourceId, reviewedHuntExecutionAuditJson } from './huntReviewedExecutionAudit';
import { reviewedAuditFixture } from './huntReviewedExecutionAudit.fixture';
it('matches original selected position 2, exact contracts and retained rows without mutating either record', () => {
  const { source, result } = reviewedAuditFixture(), before = structuredClone({ source, result });
  const audit = auditReviewedHuntExecution(result, source);
  expect(audit.completeReceipt).toBe(true); expect(audit.queries.map(query => query.originalPosition)).toEqual([2]);
  expect(audit.queries[0].source.position).toBe(2); expect(audit.queries[0].result?.rows).toEqual([{ id: 22 }]);
  expect({ source, result }).toEqual(before);
});
it.each(['id', 'fingerprint', 'hypothesis', 'selected_position', 'sql', 'parameters', 'description', 'columns', 'order', 'limit', 'bounds', 'row_fields', 'row_count', 'summary', 'missing_receipt', 'unexpected_sigma'])('refuses an inconsistent execution receipt or changed source: %s', mode => {
  const { source, result } = reviewedAuditFixture(), query = result.query_results![0];
  if (mode === 'id') source.session_id++;
  if (mode === 'fingerprint') source.fingerprint = 'c'.repeat(64);
  if (mode === 'hypothesis') source.hypothesis = 'Other hypothesis';
  if (mode === 'selected_position') query.query!.reviewed_query_number = 1;
  if (mode === 'sql') query.query!.sql += ' ';
  if (mode === 'parameters') query.query!.params = {};
  if (mode === 'description') query.query!.description = 'Different query';
  if (mode === 'columns') query.execution!.selected_columns = ['signature'];
  if (mode === 'order') query.execution!.direction = 'DESC';
  if (mode === 'limit') query.execution!.row_limit = 10;
  if (mode === 'bounds') query.time_window = {};
  if (mode === 'row_fields') query.rows = [{ id: 22, signature: 'Unselected' }];
  if (mode === 'row_count') query.row_count = 0;
  if (mode === 'summary') result.execution_summary!.attempted = 0;
  if (mode === 'missing_receipt') result.query_results = [];
  if (mode === 'unexpected_sigma') result.sigma_rule = 'Not produced by this workflow';
  expect(() => auditReviewedHuntExecution(result, source)).toThrow();
});
it.each([{}, { session_id: 81, reviewed_draft: { session_id: 81, fingerprint: 'a'.repeat(64), query_numbers: [2], scope: 'receipt' } }])('rejects absent or self-referencing provenance before any source ID is selected', value => {
  expect(() => reviewedExecutionSourceId(value)).toThrow();
});
it('accepts a saved partial execution only with exact failed and completed receipts, not a false successful empty contract', () => {
  const { source, result } = reviewedAuditFixture();
  result.reviewed_draft!.query_numbers = [1, 2]; result.status = 'partial';
  result.execution_summary = { completed: 1, failed: 1, rejected: 0, attempted: 2, skipped: 0 };
  result.query_results!.unshift({ outcome: 'failed', query: { description: source.draft.queries[0].description, sql: source.draft.queries[0].sql!, params: source.draft.queries[0].params, reviewed_query_number: 1 }, rows: [], error: 'Database interruption' });
  expect(auditReviewedHuntExecution(result, source).queries[0].result?.outcome).toBe('failed');
  result.query_results![0].execution = source.draft.queries[0].execution!;
  expect(() => auditReviewedHuntExecution(result, source)).toThrow();
});
it('keeps an interrupted run with no complete query receipt distinct from zero rows or successful completion', () => {
  const { source, result } = reviewedAuditFixture();
  result.status = 'failed'; result.error = 'Runtime interrupted'; delete result.execution_summary; delete result.query_results;
  const audit = auditReviewedHuntExecution(result, source);
  expect(audit.completeReceipt).toBe(false); expect(audit.queries[0].result).toBeNull();
});
it('compares an expired source without renewing availability or absolute bounds', () => {
  const { source, result } = reviewedAuditFixture(); source.can_execute = false; source.read_at = '2026-11-23T00:00:00Z';
  expect(auditReviewedHuntExecution(result, source).source.can_execute).toBe(false);
});
it('exports both loaded contexts and retained rows, with read times and privacy limits, and rechecks altered receipt objects', () => {
  const { source, result } = reviewedAuditFixture(), audit = auditReviewedHuntExecution(result, source);
  const value = JSON.parse(reviewedHuntExecutionAuditJson(audit, '2026-11-22T03:20:00Z', '2026-11-22T03:21:00Z'));
  expect(value.source).toEqual(source); expect(value.result).toEqual(result); expect(value.queries).toEqual(audit.queries);
  expect(value.scope).toContain('Keep private'); expect(value.scope).toContain('not atomic');
  expect(() => reviewedHuntExecutionAuditJson(audit, 'invalid', '2026-11-22T03:21:00Z')).toThrow();
  result.query_results![0].query!.sql = 'Changed';
  expect(() => reviewedHuntExecutionAuditJson(audit, '2026-11-22T03:20:00Z', '2026-11-22T03:21:00Z')).toThrow();
});
