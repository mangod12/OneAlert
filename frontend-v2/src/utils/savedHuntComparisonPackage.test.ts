import { expect, it } from 'vitest';
import type { SavedHuntSession } from './huntSessionEvidence';
import { savedHuntComparisonPackage } from './savedHuntComparisonPackage';
const a: SavedHuntSession = { id: 7, hypothesis: 'Saved hypothesis A', status: 'partial', queries_run: 2, findings_count: 100, created_at: '2026-11-21T00:00:00Z', sigma_rule: 'Not included Sigma', result_data: { query_results: [{ rows: [{ id: 900, excluded: true }] }, { query: { sql: 'SELECT id', params: { since: 'recorded bound' } }, rows: [{ id: 1 }, { id: 2 }, { id: 2 }], row_count: 100 }], agent_run_id: 90 } };
const b: SavedHuntSession = { ...a, id: 8, hypothesis: 'Saved hypothesis B', result_data: [{ rows: [{ id: 1 }, { id: 3 }], row_count: 2 }] };
const sideA = { session: a, queryIndex: 1, readAt: '2026-11-22T00:00:00Z' }, sideB = { session: b, queryIndex: 0, readAt: '2026-11-22T00:01:00Z' };
it('exports exact selected loaded queries, all sets and read times, independent of display selection', () => {
  const text = savedHuntComparisonPackage(sideA, sideB, 'onlyB', '2026-11-22T00:02:00Z'), result = JSON.parse(text);
  expect(result.format).toBe('onealert_saved_hunt_comparison_v1'); expect(result.displayed_set).toBe('onlyB');
  expect(result.counts).toEqual({ shared: 1, only_a: 2, only_b: 1 }); expect(result.records.only_a).toEqual([{ id: 2 }, { id: 2 }]);
  expect(result.source_a.query_index).toBe(2); expect(result.source_b.query_index).toBe(1); expect(result.source_a.read_at).toBe(sideA.readAt); expect(result.source_b.read_at).toBe(sideB.readAt);
  expect(result.source_a.query_result.rows).toHaveLength(3); expect(result.source_a.query_result.row_count).toBe(100); expect(result.source_a.query_result.query.params.since).toBe('recorded bound');
  expect(text).not.toContain('excluded'); expect(text).not.toContain('Not included Sigma'); expect(text).not.toContain('agent_run_id'); expect(result.same_recorded_context).toBe(false);
});
it('does not mutate original saved data or infer historical execution outcomes', () => {
  const before = JSON.stringify([a, b]); const result = JSON.parse(savedHuntComparisonPackage(sideA, sideB, 'shared', 'now'));
  expect(JSON.stringify([a, b])).toBe(before); expect(result.source_b.query_result.outcome).toBeUndefined(); expect(result.source_a.recorded_status).toBe('partial');
});
it.each([{ ...sideA, readAt: '' }, { ...sideA, queryIndex: -1 }, { ...sideA, queryIndex: 5 }, { ...sideA, session: { ...a, id: 8 } }, { ...sideA, session: { ...a, result_data: null } }])('fails closed without both exact source reads and selected saved query rows', side => {
  expect(() => savedHuntComparisonPackage(side, sideB, 'shared', 'now')).toThrow();
});
