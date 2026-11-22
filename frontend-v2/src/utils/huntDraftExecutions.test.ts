import { expect, it } from 'vitest';
import { draftExecutionPageJson, parseDraftExecutionPage } from './huntDraftExecutions';
import { draftExecutionPageFixture } from './huntDraftExecutions.fixture';
it('validates one exact source/fingerprint/page without inferring successful execution from receipt metadata', () => {
  const { source, page } = draftExecutionPageFixture();
  expect(parseDraftExecutionPage(page, source, 0, 10)).toEqual(page);
  expect(page.executions[1].status).toBe('failed'); expect(page.executions[2].receipt_supported).toBe(false);
});
it.each(['id', 'fingerprint', 'offset', 'limit', 'total', 'duplicate', 'order', 'unsupported_numbers', 'invalid_selection', 'duplicate_selection', 'self_source', 'run_bool', 'negative_count', 'missing_rows', 'oversized_page', 'read_time'])('refuses malformed or mismatched receipt pages: %s', mode => {
  const { source, page } = draftExecutionPageFixture(), row = page.executions[0];
  if (mode === 'id') page.source_session_id++;
  if (mode === 'fingerprint') page.source_fingerprint = 'b'.repeat(64);
  if (mode === 'offset') page.offset = 10;
  if (mode === 'limit') page.limit = 20;
  if (mode === 'total') page.total = 0;
  if (mode === 'duplicate') page.executions[1].session_id = row.session_id;
  if (mode === 'order') page.executions.reverse();
  if (mode === 'unsupported_numbers') Object.assign(row, { receipt_supported: false, query_numbers: [1] });
  if (mode === 'invalid_selection') row.query_numbers = [2];
  if (mode === 'duplicate_selection') row.query_numbers = [1, 1];
  if (mode === 'self_source') row.session_id = source.session_id;
  if (mode === 'run_bool') Object.assign(row, { agent_run_id: true });
  if (mode === 'negative_count') row.recorded_row_count = -1;
  if (mode === 'missing_rows') Object.assign(page, { executions: null });
  if (mode === 'oversized_page') page.executions.push({ ...row, session_id: 80 });
  if (mode === 'read_time') page.read_at = 'Not a timestamp';
  expect(() => parseDraftExecutionPage(page, source, 0, 10)).toThrow();
});
it('keeps empty pages distinct from proof that no query ran and permits empty offsets after records disappear', () => {
  const empty = draftExecutionPageFixture(0, 0); expect(parseDraftExecutionPage(empty.page, empty.source, 0, 10).executions).toEqual([]);
  const pastEnd = draftExecutionPageFixture(30, 2); expect(parseDraftExecutionPage(pastEnd.page, pastEnd.source, 30, 10).total).toBe(2);
});
it('exports only the loaded metadata page with privacy and missing-receipt caveats, not a fabricated complete result list', () => {
  const { source, page } = draftExecutionPageFixture(10), before = structuredClone(page);
  const value = JSON.parse(draftExecutionPageJson(page, source, '2026-11-22T05:41:00Z'));
  expect(value.offset).toBe(10); expect(value.executions).toHaveLength(10); expect(value.total).toBe(21);
  expect(value.query_results).toBeUndefined(); expect(value.sql).toBeUndefined(); expect(value.download_scope).toContain('Only this loaded metadata page'); expect(value.download_scope).toContain('Keep private'); expect(page).toEqual(before);
  expect(() => draftExecutionPageJson(page, source, 'bad')).toThrow();
});

it('allowlists exported metadata even if a response includes unexpected telemetry or SQL properties', () => {
  const { source, page } = draftExecutionPageFixture();
  Object.assign(page, { sql: 'private SQL', query_results: [{ raw: 'private telemetry' }] });
  Object.assign(page.executions[0], { params: { keyword: 'private parameter' }, event_rows: [{ raw: 'private rows' }] });
  const value = JSON.parse(draftExecutionPageJson(page, source, '2026-11-22T05:41:00Z'));
  expect(value.sql).toBeUndefined(); expect(value.query_results).toBeUndefined();
  expect(value.executions[0].params).toBeUndefined(); expect(value.executions[0].event_rows).toBeUndefined();
  expect(JSON.stringify(value)).not.toContain('private telemetry');
});
