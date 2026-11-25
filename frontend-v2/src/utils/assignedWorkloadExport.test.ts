import { expect, it } from 'vitest';
import { workloadPageCsv, workloadPageSnapshot, workloadPageJson } from './assignedWorkloadExport';
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
it('keeps the exact investigation drilldown in reviewed CSV scope', () => {
  const csv = workloadPageCsv(workloadPageSnapshot([task], { ...filters, investigationId: 7 }, 1, 1, '', ''));
  expect(csv).toContain('"exact_investigation_filter"'); expect(csv).toContain('"2026-11-20","","7"');
});
it('includes the applied server ordering in CSV metadata rather than a draft reorder', () => {
  const csv = workloadPageCsv(workloadPageSnapshot([task], { ...filters, sort: 'completed_newest' }, 1, 1, '', ''));
  expect(csv).toContain('"sort_order"'); expect(csv).toContain('"completed_newest"');
});

it('exports versioned JSON with exact frozen page values, nulls and booleans, not formula-prefixed CSV values',()=>{
 const snapshot=workloadPageSnapshot([{...task,title:'=SUM(A1)',completed_at:null}],{...filters,sort:'title',investigationId:7},2,30,'loaded','captured');
 const value=JSON.parse(workloadPageJson(snapshot));expect(value.format).toBe('onealert.assigned-workload-page');expect(value.version).toBe(1);expect(value.page).toBe(2);expect(value.matching_total_at_read).toBe(30);expect(value.captured_task_count).toBe(1);expect(value.tasks).toEqual([{task_id:209,investigation_id:7,title:'=SUM(A1)',investigation_title:'Gateway investigation',investigation_severity:'high',investigation_status:'resolved',completed:true,recorded_completion_at:null,task_due_date:'2026-11-20',investigation_due_date:null}]);expect(value.applied_filters).toEqual({sort:'title',query:'gateway',severity:'all',due:'range',calendar_date:'2026-11-24',completion:'completed',investigations:'all',exact_investigation_id:7,due_from:'2026-11-20',due_through:'2026-11-24'});
});
it('does not serialize incidental task/filter metadata, stale range drafts or unrelated fields',()=>{
 const row={...task,secret:'excluded',title:'<script>literal</script>\nUnicode π',completed_at:''};const f={...filters,due:'none',credential:'excluded'};
 const value=JSON.parse(workloadPageJson(workloadPageSnapshot([row],f,1,1,'','')));expect(value.tasks[0].title).toBe(row.title);expect(value.tasks[0].recorded_completion_at).toBe('');expect(value.applied_filters.due_from).toBeNull();expect(value.applied_filters.exact_investigation_id).toBeNull();expect(JSON.stringify(value)).not.toContain('excluded');
});
