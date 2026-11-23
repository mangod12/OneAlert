import { expect, it } from 'vitest';
import { checklistWorkload } from './checklistWorkload';
const task = (id: number, assignee_id: number | null, due_date: string | null, done = false) => ({ id, assignee_id, due_date, done, title: `Task ${id}`, position: id });
it('counts all loaded work with open-only local due buckets and stable identities', () => {
  const tasks = [task(1, 5, '2026-11-20'), task(2, 5, '2026-11-24'), task(3, 5, '2026-11-25'), task(4, 5, '2026-02-30'), task(5, 5, '2026-11-20', true), task(6, null, null), task(7, 99, null, true)];
  const before = JSON.stringify(tasks), rows = checklistWorkload(tasks, '2026-11-24');
  expect(rows).toEqual([{ assigneeId: 5, total: 5, open: 4, completed: 1, overdue: 1, today: 1, later: 1, undated: 1 }, { assigneeId: null, total: 1, open: 1, completed: 0, overdue: 0, today: 0, later: 0, undated: 1 }, { assigneeId: 99, total: 1, open: 0, completed: 1, overdue: 0, today: 0, later: 0, undated: 0 }]);
  expect(JSON.stringify(tasks)).toBe(before);
});
it('sorts overdue then today then open and keeps same-name accounts distinct', () => {
  expect(checklistWorkload([task(1, 9, null), task(2, 7, '2026-11-24'), task(3, 8, '2026-11-23'), task(4, 6, null)], '2026-11-24').map(r => r.assigneeId)).toEqual([8, 7, 6, 9]);
});
it('does not pretend an invalid local day classifies dated work', () => {
  expect(checklistWorkload([task(1, 5, '2026-11-23'), task(2, 5, null)], '')[0]).toMatchObject({ total: 2, open: 2, overdue: 0, today: 0, later: 0, undated: 1 });
});
it('handles an empty checklist', () => expect(checklistWorkload([], '2026-11-24')).toEqual([]));
