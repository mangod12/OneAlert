import { expect, it } from 'vitest';
import { investigationExportSnapshot, investigationSummaryCsv } from './workloadInvestigationExport';
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
