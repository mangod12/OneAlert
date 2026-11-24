import { Link } from 'react-router-dom';
interface Group { case_id: number; total: number; open: number; completed: number; without_due_date: number; }
function checkedGroups(value: unknown, groupCount: unknown, limit: unknown, total: number): Group[] | null {
  if (!Array.isArray(value) || !Number.isSafeInteger(groupCount) || (groupCount as number) < 0 || (groupCount as number) > total || (total > 0 && groupCount === 0) || limit !== 50 || value.length !== Math.min(50, groupCount as number) || new Set(value.map(row => row?.case_id)).size !== value.length) return null;
  const groups = value as Group[];
  if (groups.some((row, index) => !row || !Number.isSafeInteger(row.case_id) || row.case_id < 1 || ![row.total, row.open, row.completed, row.without_due_date].every(n => Number.isSafeInteger(n) && n >= 0) || row.total < 1 || row.open + row.completed !== row.total || row.without_due_date > row.total || (index > 0 && (groups[index - 1].total < row.total || (groups[index - 1].total === row.total && groups[index - 1].case_id >= row.case_id))))) return null;
  const sum = groups.reduce((n, row) => n + row.total, 0);
  return sum > total || ((groupCount as number) <= 50 && sum !== total) ? null : groups;
}
export function AssignedWorkloadBreakdown({ groups, groupCount, limit, total }: { groups: unknown; groupCount: unknown; limit: unknown; total: number }) {
  const checked = checkedGroups(groups, groupCount, limit, total);
  return <details className="space-y-3 rounded border border-surface-700 p-3 [overflow-wrap:anywhere]"><summary className="cursor-pointer text-sm font-semibold">Matching assigned workload by investigation</summary>
    <p className="mt-3 text-xs text-surface-400">Counts use all matching assigned tasks before task paging, under the applied filters. Ordered by matching task count, then investigation ID. Shows up to 50 investigations, not the whole workload when more match. These are current assignments, not assignment history, lateness or remediation proof. Opening a checklist requires current access and shows its whole current checklist, not this filtered workload.</p>
    {checked === null ? <p role="status" className="text-xs text-warning">Investigation breakdown unavailable. Do not infer it from this task page.</p> : <><p className="text-xs text-surface-300">Showing {checked.length} of {String(groupCount)} matching investigations{Number(groupCount) > 50 ? '. More investigations are not shown here.' : '.'}</p><ul aria-label="Assigned workload investigation counts" className="max-h-80 space-y-2 overflow-y-auto">{checked.map(row => <li key={row.case_id} className="rounded border border-surface-800 p-2 text-xs"><Link to={`/cases/${row.case_id}`} className="text-primary-300">Open whole investigation #{row.case_id} checklist</Link><p>{row.total} matching tasks · {row.open} open · {row.completed} completed · {row.without_due_date} without task due date</p></li>)}</ul></>}
  </details>;
}
