import { expect, it } from 'vitest';
import { investigationExportSnapshot, investigationSummaryCsv, investigationSummaryJson } from './workloadInvestigationExport';
const group = { case_id: 7, total: 209, open: 200, completed: 9, without_due_date: 2 };
const filters = { query: 'gateway', severity: 'all', due: 'range', today: '2026-11-24', completion: 'all', investigations: 'active', dueFrom: '2026-11-20', dueThrough: '2026-11-24', sort: 'task_due', investigationId: 7 };
it('freezes full group counts rather than task page records with applied filters', () => {
  const row = { ...group }, f = { ...filters }, snapshot = investigationExportSnapshot([row], 1, 50, 209, f, 'loaded', 'captured')!;
  row.total = 1; f.query = 'unapplied'; expect(snapshot.groups[0].total).toBe(209); expect(snapshot.filters.query).toBe('gateway');
  const csv = investigationSummaryCsv(snapshot); expect(csv).toContain('"groups_in_export"'); expect(csv).toContain('"209","50","7","209","200","9","2"'); expect(csv).toContain('"2026-11-20","2026-11-24","7","task_due"'); expect(csv).not.toContain('unapplied'); expect(csv).not.toContain('task_title');
});
it('retains explicit top50 cap, total matching groups and full matching total', () => {
  const groups = Array.from({ length: 50 }, (_, i) => ({ case_id: i + 1, total: 1, open: 1, completed: 0, without_due_date: 0 }));
  const snapshot = investigationExportSnapshot(groups, 51, 50, 51, filters, '', '')!; expect(snapshot.groups.length).toBe(50); expect(investigationSummaryCsv(snapshot)).toContain('"50","51","51","50"');
});
it.each([null, [], [null], [group, group], [{ ...group, completed: 1 }], [{ ...group, case_id: 0 }]])('refuses missing or invalid groups %j', groups => expect(investigationExportSnapshot(groups, 1, 50, 209, filters, '', '')).toBeNull());
it.each(['=SUM(A1)', '\t@cmd', '\u0000 +cmd', '\u00a0-cmd'])('escapes formula-like search text %s', query => {
  const csv = investigationSummaryCsv(investigationExportSnapshot([group], 1, 50, 209, { ...filters, query }, '', '')!); expect(csv).toContain('"\'' + query + '"');
});

it('preserves typed counts and explicit partial top50 scope in versioned JSON without adding unshown groups or tasks',()=>{
 const groups=Array.from({length:50},(_,i)=>({...group,case_id:i+1,total:1,open:1,completed:0,without_due_date:0}));const value=JSON.parse(investigationSummaryJson(investigationExportSnapshot(groups,51,50,51,filters,'loaded','captured')!));
 expect(value.format).toBe('onealert.assigned-workload-investigation-summary');expect(value.version).toBe(1);expect(value.partial).toBe(true);expect(value.omitted_group_count).toBe(1);expect(value.captured_group_count).toBe(50);expect(value.matching_investigations_at_read).toBe(51);expect(value.matching_tasks_at_read).toBe(51);expect(value.groups).toHaveLength(50);expect(value.groups[0]).toEqual({investigation_id:1,matching_tasks:1,open:1,completed:0,without_task_due_date:0});expect(value).not.toHaveProperty('tasks');expect(value.applied_filters.exact_investigation_id).toBe(7);
});
it('exports raw search text without CSV prefixing and excludes incidental fields and stale date drafts',()=>{
 const value=JSON.parse(investigationSummaryJson(investigationExportSnapshot([{...group,secret:'excluded'}],1,50,209,{...filters,due:'all',query:'=SUM(A1)',investigationId:null},'','')!));expect(value.partial).toBe(false);expect(value.omitted_group_count).toBe(0);expect(value.applied_filters.query).toBe('=SUM(A1)');expect(value.applied_filters.due_from).toBeNull();expect(value.applied_filters.exact_investigation_id).toBeNull();expect(JSON.stringify(value)).not.toContain('excluded');
});
