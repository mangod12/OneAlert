export interface WorkloadExportTask { task_id: number; case_id: number; title: string; case_title: string; case_severity: string; case_status: string; done: boolean; completed_at: string | null; due_date: string | null; case_due_date: string | null; }
export interface WorkloadExportFilters { sort?: string; query: string; severity: string; due: string; today: string; completion: string; investigations: string; dueFrom: string; dueThrough: string; investigationId?: number | null; }
export interface WorkloadPageSnapshot { tasks: WorkloadExportTask[]; filters: WorkloadExportFilters; page: number; total: number; loadedAt: string; capturedAt: string; }
export function workloadPageSnapshot(tasks: WorkloadExportTask[], filters: WorkloadExportFilters, page: number, total: number, loadedAt: string, capturedAt: string): WorkloadPageSnapshot {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(total) || total < (page - 1) * 25 + tasks.length || tasks.length > 25 || !tasks.length || new Set(tasks.map(row => row.task_id)).size !== tasks.length || tasks.some(row => !Number.isSafeInteger(row.task_id) || row.task_id < 1 || !Number.isSafeInteger(row.case_id) || row.case_id < 1)) throw Error('Invalid workload page snapshot');
  return { tasks: tasks.map(row => ({ ...row })), filters: { ...filters }, page, total, loadedAt, capturedAt };
}
export function workloadPageCsv(snapshot: WorkloadPageSnapshot): string {
  const cell = (value: unknown) => {
    const raw = String(value ?? ''); let start = 0;
    while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
    const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const f = snapshot.filters;
  const rows: unknown[][] = [['scope', 'captured_at', 'page_loaded_at', 'page', 'page_size', 'matching_total_at_read', 'title_query', 'severity_filter', 'due_filter', 'calendar_date', 'completion_filter', 'investigation_scope', 'due_window_from', 'due_window_through', 'task_id', 'investigation_id', 'task_title', 'investigation_title', 'severity', 'investigation_status', 'completed', 'recorded_completion_at', 'task_due_date', 'investigation_due_date', 'exact_investigation_filter', 'sort_order']];
  for (const task of snapshot.tasks) rows.push(['Only this loaded server page, not the full matching workload or audit history. Current assignments may change. Completion is not remediation proof; due dates alone do not prove lateness. No message or upload sent.', snapshot.capturedAt, snapshot.loadedAt, snapshot.page, 25, snapshot.total, f.query, f.severity, f.due, f.today, f.completion, f.investigations, f.due === 'range' ? f.dueFrom : '', f.due === 'range' ? f.dueThrough : '', task.task_id, task.case_id, task.title, task.case_title, task.case_severity, task.case_status, task.done, task.completed_at, task.due_date, task.case_due_date, f.investigationId ?? '', f.sort ?? 'priority']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
