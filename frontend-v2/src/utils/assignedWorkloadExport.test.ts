import { expect, it } from 'vitest';
import { workloadPageCsv, workloadPageSnapshot } from './assignedWorkloadExport';
const task = { task_id: 209, case_id: 7, title: 'Evidence, "review"\nnext', case_title: 'Gateway investigation', case_severity: 'high', case_status: 'resolved', done: true, completed_at: null, due_date: '2026-11-20', case_due_date: null };
const filters = { query: 'gateway', severity: 'all', due: 'range', today: '2026-11-24', completion: 'completed', investigations: 'all', dueFrom: '2026-11-20', dueThrough: '2026-11-24' };
it('freezes only the reviewed loaded page and applied dates with exact metadata', () => {
  const row = { ...task }, f = { ...filters }, snapshot = workloadPageSnapshot([row], f, 9, 209, 'loaded', 'captured');
  row.title = 'Changed'; f.query = 'Draft'; expect(snapshot.tasks[0].title).toBe(task.title); expect(snapshot.filters.query).toBe('gateway');
  const csv = workloadPageCsv(snapshot); expect(csv).toContain('Only this loaded server page'); expect(csv).toContain('"captured","loaded","9","25","209"'); expect(csv).toContain('"2026-11-20","2026-11-24","209","7"'); expect(csv).toContain('"true","","2026-11-20",""'); expect(csv).toContain('Evidence, ""review""\nnext');
});
it.each(['=SUM(A1)', '+12', '-5', '@cmd', '\t=cmd', '\u0000 =cmd', '\r\n@cmd', '\u00a0+cmd'])('escapes formula-like query/task/investigation titles %s', title => {
  const csv = workloadPageCsv(workloadPageSnapshot([{ ...task, title, case_title: title }], { ...filters, query: title }, 1, 1, '', ''));
  expect(csv.split('"\'' + title + '"')).toHaveLength(4);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid page %s', page => expect(() => workloadPageSnapshot([task], filters, page, 209, '', '')).toThrow());
it('rejects empty, duplicate, oversized or impossible page records', () => {
  expect(() => workloadPageSnapshot([], filters, 1, 0, '', '')).toThrow(); expect(() => workloadPageSnapshot([task, task], filters, 1, 2, '', '')).toThrow();
  expect(() => workloadPageSnapshot([task], filters, 1, 0, '', '')).toThrow(); expect(() => workloadPageSnapshot([{ ...task, case_id: 0 }], filters, 1, 1, '', '')).toThrow();
  expect(() => workloadPageSnapshot(Array.from({ length: 26 }, (_, i) => ({ ...task, task_id: i + 1 })), filters, 1, 26, '', '')).toThrow();
});
