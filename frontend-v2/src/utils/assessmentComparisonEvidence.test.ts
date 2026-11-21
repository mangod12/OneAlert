import { expect, it } from 'vitest';
import { assessmentComparisonEvidence } from './assessmentComparisonEvidence';
const before = { id: 3, control_id: 11, status: 'partial', evidence_type: null, evidence_detail: '', assessed_at: '2026-11-20T08:00:00Z', assessed_by: 'reviewer' };
const after = { ...before, id: 9, status: 'compliant', evidence_type: 'manual', evidence_detail: 'Full "recorded" evidence\nSecond line' };
it('exports exact source identities, complete values, scope and different-field list', () => {
  const result = JSON.parse(assessmentComparisonEvidence(11, [before, after], 'read', true, 'export'));
  expect(result.control_id).toBe(11); expect(result.baseline).toEqual(before); expect(result.comparison).toEqual(after); expect(result.loaded_at).toBe('read'); expect(result.exported_at).toBe('export'); expect(result.differing_field_count).toBe(3); expect(result.differing_fields).toEqual(['status','evidence_type','evidence_detail']); expect(result.displayed_fields).toHaveLength(3); expect(result.comparison.evidence_detail).toBe(after.evidence_detail); expect(result.scope).toContain('not chronology');
});
it('preserves null and empty text as distinct JSON evidence values', () => {
  const result = JSON.parse(assessmentComparisonEvidence(11, [before, { ...before, id: 9, evidence_detail: null }], 'read', true, 'export'));
  expect(result.displayed_fields).toEqual([{ field: 'evidence_detail', label: 'Recorded evidence detail', differs: true, baseline_value: '', comparison_value: null }]);
});
it('always exports both complete records while the toggle controls only the displayed-field list', () => {
  const result = JSON.parse(assessmentComparisonEvidence(11, [before, after], 'read', false, 'export'));
  expect(result.displayed_fields).toHaveLength(5); expect(result.display_filter.differing_fields_only).toBe(false); expect(result.baseline.assessed_by).toBe('reviewer'); expect(result.displayed_fields.at(-1).differs).toBe(false);
});
it('represents identical compared values without inventing a compliance outcome', () => {
  const result = JSON.parse(assessmentComparisonEvidence(11, [before, { ...before, id: 9 }], 'read', true, 'export'));
  expect(result.displayed_fields).toEqual([]); expect(result.differing_field_count).toBe(0); expect(result.total_compared_fields).toBe(5); expect(result.scope).toContain('do not prove compliance'); expect(result.comparison.id).toBe(9);
});
