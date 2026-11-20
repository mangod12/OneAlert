import { validTaskDate, type ChecklistTask } from './checklistTriage';
export type ChecklistPatch = { done: boolean } | { due_date: string | null } | { assignee_id: number | null };
export interface BatchTask extends ChecklistTask { completed_at: string | null; }
export function verifiedChecklistPatch(value: unknown, taskId: number, caseId: number, patch: ChecklistPatch): BatchTask {
  const task = value as BatchTask & { case_id: number } | null;
  if (!task || task.id !== taskId || task.case_id !== caseId || typeof task.title !== 'string' || typeof task.done !== 'boolean' || !Number.isSafeInteger(task.position) || (task.assignee_id !== null && (!Number.isSafeInteger(task.assignee_id) || task.assignee_id < 1)) || (task.due_date !== null && !validTaskDate(task.due_date)) || (task.completed_at !== null && typeof task.completed_at !== 'string') || Object.entries(patch).some(([key, value]) => task[key as keyof BatchTask] !== value)) {
    throw new Error('The saved task did not confirm this change. Refresh the checklist before retrying; the task remains selected.');
  }
  return task;
}
