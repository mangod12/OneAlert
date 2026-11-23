import type { BatchTask } from './checklistBatch';
export type BatchOutcome = 'confirmed' | 'unconfirmed' | 'not_attempted';
export interface ChecklistOutcomeReceipt { caseId: number; account: { id: number; email: string }; action: string; recordedAt: string; rows: { id: number; title: string; outcome: BatchOutcome; before: BatchTask; after: BatchTask | null }[] }
export function checklistOutcomeReceipt(caseId: number, account: { id: number; email: string }, action: string, tasks: BatchTask[], saved: BatchTask[], attempted: Set<number>, recordedAt: string): ChecklistOutcomeReceipt {
  return { caseId, account: { ...account }, action, recordedAt, rows: tasks.map(task => ({ id: task.id, title: task.title, outcome: saved.some(row => row.id === task.id) ? 'confirmed' : attempted.has(task.id) ? 'unconfirmed' : 'not_attempted', before: { ...task }, after: saved.find(row => row.id === task.id) ? { ...saved.find(row => row.id === task.id)! } : null })) };
}
export function checklistOutcomeCsv(receipt: ChecklistOutcomeReceipt) {
  const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const heading = ['investigation_id', 'acting_account_id', 'acting_account_email', 'reviewed_action', 'recorded_at', 'task_id', 'task_title', 'outcome', 'before_done', 'before_due_date', 'before_assignee_id', 'confirmed_done', 'confirmed_due_date', 'confirmed_assignee_id', 'scope'];
  const scope = 'Local save-response receipt, not current state, complete audit history, notification delivery or remediation proof. Unconfirmed may have applied. Not attempted means no save was sent by this batch.';
  return '\uFEFF' + [heading, ...receipt.rows.map(row => [receipt.caseId, receipt.account.id, receipt.account.email, receipt.action, receipt.recordedAt, row.id, row.title, row.outcome, row.before.done, row.before.due_date, row.before.assignee_id, row.after?.done, row.after?.due_date, row.after?.assignee_id, scope])].map(row => row.map(cell).join(',')).join('\r\n');
}
