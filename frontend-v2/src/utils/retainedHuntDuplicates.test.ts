import { describe, expect, it } from 'vitest';
import { retainedHuntDuplicateGroups } from './retainedHuntDuplicates';

describe('Repeated full retained row values', () => {
  it('groups entire typed rows in original first-position order without mutating evidence', () => {
    const rows = [{ id: 1, nested: { b: false, a: 0 } }, { id: 2 }, { nested: { a: 0, b: false }, id: 1 }, { id: 2 }, { id: 3 }];
    const before = JSON.stringify(rows);
    expect(retainedHuntDuplicateGroups(rows)).toEqual([[1, 3], [2, 4]]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('distinguishes absence, null, false, zero, empty text and nested array order', () => {
    expect(retainedHuntDuplicateGroups([{}, { a: null }, { a: false }, { a: 0 }, { a: '' }, { a: [1, 2] }, { a: [2, 1] }, {}, { a: null }])).toEqual([[1, 8], [2, 9]]);
  });
  it('does not group rows by shared IDs alone and handles empty and unique evidence', () => {
    expect(retainedHuntDuplicateGroups([{ id: 1, value: 'a' }, { id: 1, value: 'b' }])).toEqual([]);
    expect(retainedHuntDuplicateGroups([])).toEqual([]);
  });
});
