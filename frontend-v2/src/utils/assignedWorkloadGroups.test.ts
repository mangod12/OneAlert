import { expect, it } from 'vitest';
import { checkedWorkloadGroups } from './assignedWorkloadGroups';
import { investigationExportSnapshot } from './workloadInvestigationExport';
const row = { case_id: 7, total: 4, open: 3, completed: 1, without_due_date: 2 };
const filters = { query: '', severity: 'all', today: '2026-11-25', investigations: 'active', completion: 'all', due: 'all', dueFrom: '', dueThrough: '', investigationId: null as number | null };
it.each([
 { completion: 'open' }, { completion: 'completed' }, { due: 'none' }, { due: 'overdue' }, { due: 'today' }, { due: 'future' }, { due: 'range' }, { investigationId: 8 },
])('rejects otherwise valid counts outside applied scope %j for both breakdown and export', scope => {
 const applied = { ...filters, ...scope };
 expect(checkedWorkloadGroups([row], 1, 50, 4, applied)).toBeNull();
 expect(investigationExportSnapshot([row], 1, 50, 4, applied, '', '')).toBeNull();
});
it.each([
 { scope: { completion: 'open' }, counts: { open: 4, completed: 0 } },
 { scope: { completion: 'completed' }, counts: { open: 0, completed: 4 } },
 { scope: { due: 'none' }, counts: { without_due_date: 4 } },
 ...['overdue', 'today', 'future', 'range'].map(due => ({ scope: { due }, counts: { without_due_date: 0 } })),
 { scope: { investigationId: 7 }, counts: {} }, { scope: {}, counts: {} },
])('retains counts compatible with the applied scope %j', ({ scope, counts }) => {
 const groups = [{ ...row, ...counts }], applied = { ...filters, ...scope };
 expect(checkedWorkloadGroups(groups, 1, 50, 4, applied)).toEqual(groups);
 expect(investigationExportSnapshot(groups, 1, 50, 4, applied, '', '')?.groups).toEqual(groups);
});
it('checks every loaded group in a partial capped result', () => {
 const groups = Array.from({ length: 50 }, (_, i) => ({ ...row, case_id: i + 1, total: 1, open: 1, completed: 0, without_due_date: 0 }));
 groups[49].open = 0; groups[49].completed = 1;
 expect(checkedWorkloadGroups(groups, 51, 50, 51, { ...filters, completion: 'open' })).toBeNull();
});
