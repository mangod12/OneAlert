import type { ChecklistTask } from './checklistTriage';
import { checklistExportEvidenceValid } from './checklistSnapshotExport';
const fields = ['title', 'done', 'due_date', 'assignee_id', 'position'] as const;
export function checklistComparisonJson(baseline: ChecklistTask, comparison: ChecklistTask): string {
  if (!checklistExportEvidenceValid(1, [baseline, comparison], 2)) throw Error('Invalid captured task comparison');
  const task = (value: ChecklistTask) => ({ task_id: value.id, title: value.title, completed: value.done, due_date: value.due_date, assignee_id: value.assignee_id, checklist_position: value.position });
  return JSON.stringify({ format: 'onealert.captured-checklist-task-comparison', version: 1, scope: 'Only two tasks from a frozen loaded checklist review. Baseline is a viewing choice, not an older version, assignment history, timeliness or remediation proof. Assignee IDs are recorded IDs, not current names. No investigation context or full capture is included. All saved fields are included regardless of difference focus. No upload, message or access grant sent.', baseline: task(baseline), comparison: task(comparison), different_fields: fields.filter(key => baseline[key] !== comparison[key]) }, null, 2) + '\n';
}
