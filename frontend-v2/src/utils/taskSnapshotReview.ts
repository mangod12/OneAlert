export interface SnapshotAssignedTask { task_id: number; case_id: number; case_title: string; case_severity: string; case_status: string; case_due_date: string | null; title: string; due_date: string | null; created_at: string }
export type SnapshotTaskChange = { done: true } | { due_date: string | null };
const fail = () => Error('The exact assigned task state could not be verified. Refresh tasks before another change.');
export function checkedTaskDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function checkedTaskSnapshot(value: unknown): SnapshotAssignedTask[] {
  if (!Array.isArray(value) || value.length > 200) throw fail();
  const rows = value.map(row => {
    if (!row || !Number.isSafeInteger(row.task_id) || row.task_id < 1 || !Number.isSafeInteger(row.case_id) || row.case_id < 1 || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300 || typeof row.case_title !== 'string' || !row.case_title.trim() || !['critical', 'high', 'medium', 'low', 'info'].includes(row.case_severity) || typeof row.case_status !== 'string' || !row.case_status || ['resolved', 'closed', 'false_positive'].includes(row.case_status) || !checkedTaskDate(row.due_date) || !checkedTaskDate(row.case_due_date) || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw fail();
    return { task_id: row.task_id, case_id: row.case_id, title: row.title, case_title: row.case_title, case_severity: row.case_severity, case_status: row.case_status, due_date: row.due_date, case_due_date: row.case_due_date, created_at: row.created_at };
  });
  if (new Set(rows.map(row => row.task_id)).size !== rows.length) throw fail();
  return rows;
}
export function sameSnapshotTask(a: SnapshotAssignedTask, b: SnapshotAssignedTask) { return JSON.stringify(a) === JSON.stringify(b); }
export function reviewedTaskPayload(task: SnapshotAssignedTask, change: SnapshotTaskChange) {
  const complete = 'done' in change;
  if (!complete && (!checkedTaskDate(change.due_date) || change.due_date === task.due_date)) throw fail();
  return { case_id: task.case_id, expected_title: task.title, expected_done: false, expected_due_date: task.due_date, expected_case_title: task.case_title, expected_case_status: task.case_status, action: complete ? 'complete' : change.due_date === null ? 'clear_due' : 'set_due', due_date: complete ? null : change.due_date };
}
export function checkedSnapshotTaskResult(task: SnapshotAssignedTask, change: SnapshotTaskChange, status: number, value: unknown) {
  const row = value as Record<string, unknown> | null, complete = 'done' in change;
  if (status !== 200 || !row || row.id !== task.task_id || row.case_id !== task.case_id || row.title !== task.title || row.done !== complete || row.due_date !== (complete ? task.due_date : change.due_date) || !Number.isSafeInteger(row.assignee_id) || Number(row.assignee_id) < 1 || (complete ? typeof row.completed_at !== 'string' || !Number.isFinite(Date.parse(row.completed_at)) : row.completed_at !== null)) throw fail();
  return { done: complete, due_date: row.due_date as string | null };
}
export function checkedTaskAccount(value: unknown) {
  const who = value as Record<string, unknown> | null;
  if (!who || !Number.isSafeInteger(who.id) || Number(who.id) < 1 || typeof who.email !== 'string' || !who.email || who.is_active !== true || !['admin', 'analyst', 'viewer'].includes(who.role as string) || who.org_id !== null && (!Number.isSafeInteger(who.org_id) || Number(who.org_id) < 1)) throw fail();
  return { id: who.id as number, email: who.email, role: who.role as string, org_id: who.org_id as number | null };
}
