import { expect, it } from 'vitest';
import { matchingComparisonPositions, planComparisonEvidence } from './responsePlanComparisonExport';
const before = { id: 7, case_id: 4, status: 'approved', autonomy_level: 'L1', actions: [{ target: 'gateway', optional: null }, null] };
const after = { id: 8, case_id: 4, status: 'partial', autonomy_level: 'L2', actions: [{ optional: null, target: 'gateway' }, { target: 'Rare new host', execution: { mode: 'simulated' } }, null] };
it('searches canonical full JSON, position and change labels literally without mutating original data', () => {
  expect(matchingComparisonPositions(before, after, true, 'rare NEW')).toHaveLength(1);
  expect(matchingComparisonPositions(before, after, true, 'execution')).toHaveLength(1);
  expect(matchingComparisonPositions(before, after, false, 'gateway')[0].change).toBe('unchanged');
  expect(matchingComparisonPositions(before, after, true, 'gateway')).toHaveLength(0);
  expect(matchingComparisonPositions(before, after, false, '.*')).toHaveLength(0);
  expect(matchingComparisonPositions(before, after, false, '3')[0].position).toBe(3);
  expect(matchingComparisonPositions(before, after, true, 'added')[0].position).toBe(3);
  expect(before.actions[1]).toBeNull();
});
it('exports matching positions only with complete action values, exact identities, metadata and unfiltered counts', () => {
  const result = JSON.parse(planComparisonEvidence({ before, after, loadedAt: 'loaded' }, { changedOnly: true, query: ' Rare ' }, 'exported'));
  expect(result.matching_positions).toHaveLength(1); expect(result.matching_positions[0]).toEqual({ position: 2, change: 'changed', baseline_present: true, comparison_present: true, baseline_action: null, comparison_action: after.actions[1] });
  expect(result.position_counts_before_filters).toEqual({ changed: 1, added: 1, removed: 0, unchanged: 1 }); expect(result.total_positions).toBe(3); expect(result.filters.search).toBe('Rare'); expect(result.baseline.id).toBe(7); expect(result.comparison.id).toBe(8); expect(result.metadata_differences).toEqual({ status: true, autonomy_level: true }); expect(result.loaded_at).toBe('loaded'); expect(result.exported_at).toBe('exported');
});
it('does not conflate absent positions and explicit null actions', () => {
  const result = JSON.parse(planComparisonEvidence({ before, after, loadedAt: 'loaded' }, { changedOnly: true, query: 'added' }, 'exported'));
  expect(result.matching_positions[0]).toEqual({ position: 3, change: 'added', baseline_present: false, comparison_present: true, comparison_action: null });
});
it('retains metadata and original counts when no action positions match', () => {
  const result = JSON.parse(planComparisonEvidence({ before, after, loadedAt: 'loaded' }, { changedOnly: true, query: 'no match' }, 'exported'));
  expect(result.matching_positions).toEqual([]); expect(result.total_positions).toBe(3); expect(result.metadata_differences.status).toBe(true); expect(result.scope).toContain('not identity or chronology');
});
