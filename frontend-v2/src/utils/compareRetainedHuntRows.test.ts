import { expect, it } from 'vitest';
import { compareRetainedHuntRows } from './compareRetainedHuntRows';
it('compares exact row multisets, ignoring object key order and preserving duplicates', () => {
  const value = compareRetainedHuntRows({ rows: [{ id: 1, host: 'a' }, { id: 1, host: 'a' }, { id: 2 }] }, { rows: [{ host: 'a', id: 1 }, { id: 3 }] });
  expect(value.shared).toEqual([{ id: 1, host: 'a' }]); expect(value.onlyA).toEqual([{ id: 1, host: 'a' }, { id: 2 }]); expect(value.onlyB).toEqual([{ id: 3 }]);
});
it('preserves missing versus null and array order while normalizing nested object field order', () => {
  const result = compareRetainedHuntRows({ rows: [{ a: null }, {}, { a: [1, 2] }, { a: { b: 2, c: 3 } }] }, { rows: [{ a: [2, 1] }, { a: { c: 3, b: 2 } }] });
  expect(result.shared).toHaveLength(1); expect(result.onlyA).toHaveLength(3); expect(result.onlyB).toHaveLength(1);
});
it('does not infer absent rows as an empty result and bounds legacy arrays', () => {
  expect(() => compareRetainedHuntRows({}, { rows: [] })).toThrow(/Missing rows/);
  expect(() => compareRetainedHuntRows({ rows: Array.from({ length: 1001 }, () => ({})) }, { rows: [] })).toThrow(/1,000/);
  expect(compareRetainedHuntRows({ rows: [] }, { rows: [] }).shared).toEqual([]);
});
it('checks complete recorded query and applied context, not row similarity', () => {
  const query = { rows: [], query: { sql: 'SELECT id FROM security_events WHERE user_id = :user_id', params: { since: '2026-01-01T00:00:00Z' } } };
  expect(compareRetainedHuntRows(query, { ...query }).sameRecordedContext).toBe(true);
  expect(compareRetainedHuntRows(query, { ...query, query: { ...query.query, params: { since: '2026-02-01T00:00:00Z' } } }).sameRecordedContext).toBe(false);
});

it('includes failed versus completed execution outcome in the recorded context comparison', () => {
  expect(compareRetainedHuntRows({ rows: [], outcome: 'failed', error: 'Selection rejected' }, { rows: [], outcome: 'completed' }).sameRecordedContext).toBe(false);
});
