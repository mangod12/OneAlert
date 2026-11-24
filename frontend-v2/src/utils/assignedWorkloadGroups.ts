export interface WorkloadGroup { case_id: number; total: number; open: number; completed: number; without_due_date: number; }
export function checkedWorkloadGroups(value: unknown, groupCount: unknown, limit: unknown, total: number): WorkloadGroup[] | null {
  if (!Array.isArray(value) || !Number.isSafeInteger(groupCount) || (groupCount as number) < 0 || (groupCount as number) > total || (total > 0 && groupCount === 0) || limit !== 50 || value.length !== Math.min(50, groupCount as number) || new Set(value.map(row => row?.case_id)).size !== value.length) return null;
  const groups = value as WorkloadGroup[];
  if (groups.some((row, index) => !row || !Number.isSafeInteger(row.case_id) || row.case_id < 1 || ![row.total, row.open, row.completed, row.without_due_date].every(n => Number.isSafeInteger(n) && n >= 0) || row.total < 1 || row.open + row.completed !== row.total || row.without_due_date > row.total || (index > 0 && (groups[index - 1].total < row.total || (groups[index - 1].total === row.total && groups[index - 1].case_id >= row.case_id))))) return null;
  const sum = groups.reduce((n, row) => n + row.total, 0);
  return sum > total || ((groupCount as number) <= 50 && sum !== total) ? null : groups;
}
