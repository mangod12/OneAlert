import { expect, it } from 'vitest';
import { defaultChecklistFilters, filterChecklist, validTaskDate } from './checklistTriage';
const tasks = [
  { id: 1, title: 'Inspect Gateway', done: false, position: 1, assignee_id: 5, due_date: '2026-11-20' },
  { id: 2, title: 'Collect logs', done: false, position: 0, assignee_id: null, due_date: '2026-11-21' },
  { id: 3, title: 'Notify reviewer', done: true, position: 2, assignee_id: 5, due_date: '2026-11-19' },
  { id: 4, title: 'Future work', done: false, position: 3, assignee_id: 8, due_date: '2026-11-22' },
  { id: 5, title: 'Undated work', done: false, position: 4, assignee_id: null, due_date: null },
];
const ids = (overrides: Partial<typeof defaultChecklistFilters>, today = '2026-11-21', me: number | null = 5) => filterChecklist(tasks, { ...defaultChecklistFilters, ...overrides }, today, me).map(task => task.id);
it('combines title/status/assignee/due filters without changing source tasks', () => {
  expect(ids({ query: ' GATEWAY ', status: 'open', assignee: 'mine', due: 'overdue' })).toEqual([1]);
  expect(ids({ status: 'done', due: 'overdue' })).toEqual([]);
  expect(ids({ assignee: 'mine' }, '2026-11-21', null)).toEqual([]);
  expect(ids({ assignee: 'unassigned' })).toEqual([2, 5]); expect(tasks[0].id).toBe(1);
});
it('classifies overdue/today/later only for open tasks and valid dates', () => {
  expect(ids({ due: 'overdue' })).toEqual([1]); expect(ids({ due: 'today' })).toEqual([2]);
  expect(ids({ due: 'upcoming' })).toEqual([4]); expect(ids({ due: 'undated' })).toEqual([5]);
  expect(ids({ due: 'overdue' }, '')).toEqual([]);
  expect(validTaskDate('2026-02-30')).toBe(false); expect(validTaskDate('2028-02-29')).toBe(true);
});
it('sorts deterministically without persisting order and keeps undated last', () => {
  expect(ids({ sort: 'due' })).toEqual([3, 1, 2, 4, 5]);
  expect(ids({ sort: 'position' })).toEqual([2, 1, 3, 4, 5]);
  expect(ids({ sort: 'title' })).toEqual([2, 4, 1, 3, 5]);
});
it('filters fixed inclusive due windows independently of local today, excluding completed and invalid dates', () => {
  expect(ids({ due: 'range', dueFrom: '2026-11-20', dueTo: '2026-11-21' }, '')).toEqual([2, 1]);
  expect(ids({ due: 'range', dueFrom: '2026-11-21', dueTo: '2026-11-21' }, '2030-01-01')).toEqual([2]);
  expect(ids({ due: 'range', dueFrom: '2026-11-19', dueTo: '2026-11-22' })).toEqual([2, 1, 4]);
});
it.each([{ dueFrom: '', dueTo: '2026-11-22' }, { dueFrom: '2026-02-30', dueTo: '2026-11-22' }, { dueFrom: '2026-11-22', dueTo: '2026-11-20' }])('fails closed on incomplete or invalid fixed windows %s', range => expect(ids({ due: 'range', ...range })).toEqual([]));
