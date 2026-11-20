import { expect, it } from 'vitest';
import { verifiedTaskSave } from './verifiedTaskSave';
const saved = { id: 1, case_id: 7, done: false, due_date: '2026-11-21' };
it('requires exact task and investigation identity with the requested saved date', () => {
  expect(verifiedTaskSave(saved, 1, 7, { due_date: '2026-11-21' })).toEqual(saved);
  expect(verifiedTaskSave({ ...saved, due_date: null }, 1, 7, { due_date: null }).due_date).toBeNull();
});
it.each([null, {}, { ...saved, id: 2 }, { ...saved, case_id: 8 }, { ...saved, done: 'false' }, { ...saved, due_date: undefined }, { ...saved, due_date: '2026-11-22' }])('does not report a due-date success for malformed or mismatched replies', value => {
  expect(() => verifiedTaskSave(value, 1, 7, { due_date: '2026-11-21' })).toThrow(/not confirmed/);
});
it('requires explicit saved completion and never infers it from a truthy value', () => {
  expect(verifiedTaskSave({ ...saved, done: true }, 1, 7, { done: true }).done).toBe(true);
  expect(() => verifiedTaskSave(saved, 1, 7, { done: true })).toThrow(/Completion was not confirmed/);
  expect(() => verifiedTaskSave({ ...saved, done: 'true' }, 1, 7, { done: true })).toThrow();
});
