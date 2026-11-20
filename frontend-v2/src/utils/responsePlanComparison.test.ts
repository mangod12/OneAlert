import { expect, it } from 'vitest';
import { compareActionPositions, stableEvidence } from './responsePlanComparison';
it('ignores object key ordering including nested objects, but preserves array order', () => {
  expect(stableEvidence({ b: { d: 2, c: 1 }, a: 0 })).toBe(stableEvidence({ a: 0, b: { c: 1, d: 2 } }));
  expect(compareActionPositions([[1, 2]], [[2, 1]])[0].change).toBe('changed');
});
it('keeps missing fields, null, false, zero and empty strings distinct', () => {
  expect(new Set([{}, { x: null }, { x: false }, { x: 0 }, { x: '' }].map(stableEvidence)).size).toBe(5);
});
it('aligns stored positions without pretending reordered actions share identity', () => {
  expect(compareActionPositions(['A', 'B'], ['B', 'A']).map(row => row.change)).toEqual(['changed', 'changed']);
  expect(compareActionPositions(['A'], ['A', null]).map(row => row.change)).toEqual(['unchanged', 'added']);
  expect(compareActionPositions(['A', null], ['A'])[1]).toMatchObject({ position: 2, before: 'null', after: null, change: 'removed' });
});
it('preserves complete structured legacy values without conversion calls', () => {
  expect(stableEvidence({ toString: 'saved-data', priority: 0 })).toContain('"toString": "saved-data"');
});
