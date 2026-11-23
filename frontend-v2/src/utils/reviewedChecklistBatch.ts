import apiClient from '../api/client';
import { verifiedChecklistPatch, type BatchTask, type ChecklistPatch } from './checklistBatch';
import { checkedTaskAccount } from './taskSnapshotReview';
export interface ReviewedBatchTask { task: BatchTask; fingerprint: string; endpoint: string; patch: ChecklistPatch; effects: string; caseTitle: string }
export function taskChangeEndpoint(patch: ChecklistPatch) { return 'done' in patch ? 'completion' : 'due_date' in patch ? 'due' : 'assignment'; }
export function checkedBatchReview(data: unknown, task: BatchTask, caseId: number, patch: ChecklistPatch, account: ReturnType<typeof checkedTaskAccount>): ReviewedBatchTask {
  const row = data as Record<string, unknown> | null, saved = row?.task as Record<string, unknown> | undefined;
  if (!row || row.case_id !== caseId || row.owner_id !== account.id && row.assigned_to_id !== account.id || typeof row.title !== 'string' || !row.title || typeof row.status !== 'string' || typeof row.severity !== 'string' || typeof row.reviewed_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.reviewed_fingerprint) || !saved || ['id', 'title', 'done', 'due_date', 'assignee_id', 'position', 'completed_at'].some(key => saved[key] !== task[key as keyof BatchTask])) throw Error('The saved task or account changed. Reload the checklist and review again.');
  const proposal = 'done' in patch ? row.proposed_done === patch.done : 'due_date' in patch ? row.proposed_due_date === patch.due_date : row.proposed_assignee_id === patch.assignee_id;
  if (!proposal) throw Error('The proposed task change could not be verified.');
  if ('assignee_id' in patch) {
    const person = row.proposed_assignee as Record<string, unknown> | null;
    if (typeof row.grants_investigation_access !== 'boolean' || typeof row.assignment_notification !== 'boolean' || !Array.isArray(row.retained_access_reasons) || row.retained_access_reasons.some(x => typeof x !== 'string') || !Array.isArray(row.target_existing_access_reasons) || row.target_existing_access_reasons.some(x => typeof x !== 'string') || (patch.assignee_id === null ? person !== null : !person || person.id !== patch.assignee_id || typeof person.email !== 'string' || !person.email || person.is_active !== true || person.org_id !== account.org_id) || row.assignment_notification !== (patch.assignee_id !== null && patch.assignee_id !== account.id) || row.grants_investigation_access !== (patch.assignee_id !== null && row.target_existing_access_reasons.length === 0)) throw Error('The exact assignment audience could not be verified.');
  }
  const effects = 'assignee_id' in patch ? `Target: ${(row.proposed_assignee as { email: string } | null)?.email ?? 'Unassigned'}. New investigation access: ${row.grants_investigation_access ? 'yes' : 'no'}. Assignment notification: ${row.assignment_notification ? 'yes' : 'none'}. Former account retained access: ${(row.retained_access_reasons as string[]).join(', ') || 'none recorded'}.` : 'done' in patch ? 'Completion timestamp and timeline change. Assigned-account investigation access remains. No immediate completion notification. Reminder markers are not reset.' : 'Due date and timeline change. Reminder markers reset; later scheduler notifications may follow. Assignment and investigation access stay unchanged.';
  return { task, fingerprint: row.reviewed_fingerprint, endpoint: taskChangeEndpoint(patch), patch, effects, caseTitle: row.title as string };
}
export async function saveReviewedBatchTask(row: ReviewedBatchTask, caseId: number): Promise<BatchTask> {
  const response = await apiClient.patch(`/cases/${caseId}/tasks/${row.task.id}/${row.endpoint}-reviewed`, row.patch, { params: { reviewed_fingerprint: row.fingerprint } });
  if (response.status !== 200) throw Error('Unconfirmed task save');
  const saved = verifiedChecklistPatch(response.data, row.task.id, caseId, row.patch);
  if (saved.title !== row.task.title || saved.position !== row.task.position || !('done' in row.patch) && (saved.done !== row.task.done || saved.completed_at !== row.task.completed_at) || !('due_date' in row.patch) && saved.due_date !== row.task.due_date || !('assignee_id' in row.patch) && saved.assignee_id !== row.task.assignee_id) throw Error('Unconfirmed independent task state');
  return saved;
}
