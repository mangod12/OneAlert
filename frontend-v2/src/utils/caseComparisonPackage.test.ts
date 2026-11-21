import { expect, it } from 'vitest';
import { caseComparisonPackage } from './caseComparisonPackage';
export const comparisonPackageFixture = { format: 'onealert_case_evidence_comparison_v1', exported_at: '2026-11-22T00:00:00Z', case_id: 7, other_case_id: 8, kind: 'alert', case_title: 'Source', other_case_title: 'Other', source_count: 2, other_count: 2, record_count: 3, set_counts: { shared: 1, source_only: 1, other_only: 1 }, records: { shared: [{ id: 1, label: 'Shared', severity: 'high', recorded_at: null, can_open_original: false }], source_only: [{ id: 2, label: '=Literal "row"\nnext', severity: null, recorded_at: null, can_open_original: true }], other_only: [{ id: 3, label: null, severity: 'low', recorded_at: '2026-11-21T00:00:00Z', can_open_original: false }] }, scope: 'Exact IDs, no common incident inferred.' };
it('preserves all sets and literal JSON values while stripping unrelated fields', () => {
  const value = JSON.parse(caseComparisonPackage({ ...comparisonPackageFixture, private_debug: 'Do not export', records: { ...comparisonPackageFixture.records, shared: [{ ...comparisonPackageFixture.records.shared[0], raw_payload: 'Do not export' }] } }, 7, 8, 'alert'));
  expect(value.records.source_only[0].label).toBe('=Literal "row"\nnext'); expect(value.private_debug).toBeUndefined(); expect(value.records.shared[0].raw_payload).toBeUndefined(); expect(value.record_count).toBe(3);
});
it.each([{ case_id: 9 }, { other_case_id: 9 }, { kind: 'event' }, { source_count: 3 }, { other_count: 3 }, { record_count: 2 }, { record_count: 10001 }, { exported_at: null }, { set_counts: { shared: 0, source_only: 1, other_only: 1 } }, { records: null }, { records: { ...comparisonPackageFixture.records, shared: [] } }, { records: { ...comparisonPackageFixture.records, shared: [{ ...comparisonPackageFixture.records.shared[0], id: 2 }] } }, { records: { ...comparisonPackageFixture.records, shared: [{ ...comparisonPackageFixture.records.shared[0], label: {} }] } }])('fails closed on unbound, duplicate, missing or inconsistent data %j', changes => {
  expect(() => caseComparisonPackage({ ...comparisonPackageFixture, ...changes }, 7, 8, 'alert')).toThrow(/No file was saved/);
});
it('represents complete zero-record comparisons with metadata intact', () => {
  const value = JSON.parse(caseComparisonPackage({ ...comparisonPackageFixture, source_count: 0, other_count: 0, record_count: 0, set_counts: { shared: 0, source_only: 0, other_only: 0 }, records: { shared: [], source_only: [], other_only: [] } }, 7, 8, 'alert'));
  expect(value.record_count).toBe(0); expect(value.scope).toBeTruthy();
});
