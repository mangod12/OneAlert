import { expect, it } from 'vitest';
import { verifiedChecklistPatch, type ChecklistPatch } from './checklistBatch';
const task = { id: 1, case_id: 7, title: 'Review evidence', done: false, position: 0, due_date: null, assignee_id: null, completed_at: null };
it.each<ChecklistPatch>([{ done: true }, { done: false }, { due_date: '2026-11-25' }, { due_date: null }, { assignee_id: 5 }, { assignee_id: null }])('accepts the exact requested checklist patch %j', patch => {
  expect(verifiedChecklistPatch({ ...task, ...patch }, 1, 7, patch)).toMatchObject(patch);
});
it.each([{ id: 2 }, { case_id: 9 }, { done: 'yes' }, { due_date: '2026-02-30' }, { position: 1.5 }, { assignee_id: 0 }, { completed_at: true }])('rejects unconfirmed or malformed saved task %j', override => {
  expect(() => verifiedChecklistPatch({ ...task, ...override }, 1, 7, { done: false })).toThrow('did not confirm');
});
it('rejects a valid row that did not save the selected value', () => {
  expect(() => verifiedChecklistPatch(task, 1, 7, { done: true })).toThrow('did not confirm');
  expect(() => verifiedChecklistPatch(task, 1, 7, { due_date: '2026-11-25' })).toThrow('did not confirm');
  expect(() => verifiedChecklistPatch(task, 1, 7, { assignee_id: 5 })).toThrow('did not confirm');
});
