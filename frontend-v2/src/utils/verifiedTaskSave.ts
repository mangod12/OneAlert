export type TaskSavePayload = { done: true } | { due_date: string | null };
interface SavedTask { id: number; case_id: number; done: boolean; due_date: string | null; }
export function verifiedTaskSave(value: unknown, taskId: number, caseId: number, payload: TaskSavePayload): SavedTask {
  const saved = value as SavedTask | null;
  const completion = 'done' in payload;
  if (!saved || saved.id !== taskId || saved.case_id !== caseId || typeof saved.done !== 'boolean' || (saved.due_date !== null && typeof saved.due_date !== 'string') || (completion ? saved.done !== true : saved.due_date !== payload.due_date)) {
    throw new Error(completion ? 'Completion was not confirmed for this task. Refresh tasks to verify before retrying.' : 'The due-date update was not confirmed for this task. Your draft is kept. Refresh tasks to verify before retrying.');
  }
  return saved;
}
