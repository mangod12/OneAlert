import { type ChecklistFilters, type ChecklistTask } from './checklistTriage';
export interface ChecklistExportSnapshot { caseId: number; capturedAt: string; localDate: string; loadedCount: number; filters: ChecklistFilters; tasks: ChecklistTask[]; }
export function checklistExportSnapshot(caseId: number, tasks: ChecklistTask[], loadedCount: number, filters: ChecklistFilters, localDate: string, capturedAt: string): ChecklistExportSnapshot {
  if (!Number.isSafeInteger(caseId) || caseId < 1 || loadedCount < tasks.length) throw Error('Invalid checklist export scope');
  return { caseId, capturedAt, localDate, loadedCount, filters: { ...filters }, tasks: tasks.map(task => ({ ...task })) };
}
export function checklistSnapshotCsv(snapshot: ChecklistExportSnapshot): string {
  const cell = (value: unknown) => {
    const raw = String(value ?? ''); let start = 0;
    while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/u.test(raw[start]))) start++;
    const safe = '=+@-'.includes(raw[start] ?? '\uffff') ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const scope = 'Local loaded checklist snapshot, all matching rows across pages, not freshly fetched, not complete audit history or remediation proof. Review before sharing. No message, upload or task save was sent.';
  const { filters: f } = snapshot;
  const rows: unknown[][] = [['investigation_id', 'captured_at', 'local_date_for_filters', 'loaded_task_count', 'matching_task_count', 'title_query', 'status_filter', 'assignee_filter', 'due_filter', 'sort_order', 'task_id', 'task_title', 'completed', 'due_date', 'assignee_id', 'checklist_position', 'scope', 'due_window_from', 'due_window_through']];
  for (const task of snapshot.tasks) rows.push([snapshot.caseId, snapshot.capturedAt, snapshot.localDate, snapshot.loadedCount, snapshot.tasks.length, f.query, f.status, f.assignee, f.due, f.sort, task.id, task.title, task.done, task.due_date, task.assignee_id, task.position, scope, f.due === 'range' ? f.dueFrom : '', f.due === 'range' ? f.dueTo : '']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function checklistSnapshotJson(snapshot: ChecklistExportSnapshot): string {
  const f = snapshot.filters;
  return JSON.stringify({
    format: 'onealert.checklist-snapshot', version: 1, investigation_id: snapshot.caseId,
    scope: 'Only frozen matching rows from the loaded checklist across local pages, not freshly fetched state, assignment history, timeline, complete audit history or remediation proof. No message, upload or task save sent.',
    captured_at: snapshot.capturedAt, local_date_for_filters: snapshot.localDate || null,
    loaded_task_count: snapshot.loadedCount, captured_task_count: snapshot.tasks.length,
    filters: { query: f.query, status: f.status, assignee: f.assignee, due: f.due, sort: f.sort, due_from: f.due === 'range' ? f.dueFrom ?? null : null, due_through: f.due === 'range' ? f.dueTo ?? null : null },
    tasks: snapshot.tasks.map(task => ({ task_id: task.id, title: task.title, completed: task.done, due_date: task.due_date, assignee_id: task.assignee_id, checklist_position: task.position })),
  }, null, 2) + '\n';
}
