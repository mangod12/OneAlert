import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useDialogFocus } from './ui/useDialogFocus';
export interface EditableAssignedTask { task_id: number; case_id: number; title: string; done: boolean; due_date: string | null; case_title: string; case_status: string }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
export function AssignedTaskEditor({ task, onClose, onChanged }: { task: EditableAssignedTask; onClose: () => void; onChanged: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true);
  const [action, setAction] = useState(task.done ? 'reopen' : 'complete'), [date, setDate] = useState(task.due_date ?? ''), [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useDialogFocus(dialog, () => { if (!pending.current) onClose(); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changesDate = action === 'set_due' || action === 'clear_due';
  const newDate = action === 'set_due' ? date : null;
  const valid = !changesDate || (action !== 'set_due' || /^\d{4}-\d{2}-\d{2}$/.test(date)) && newDate !== task.due_date;
  const save = async () => {
    if (pending.current || !review || !valid || error) return;
    pending.current = true; setBusy(true);
    try {
      const response = await apiClient.patch(`/cases/assigned-task-explorer/${task.task_id}`, { case_id: task.case_id, expected_title: task.title, expected_done: task.done, expected_due_date: task.due_date, expected_case_title: task.case_title, expected_case_status: task.case_status, action, due_date: action === 'set_due' ? date : null });
      const value = response.data;
      if (!value || value.id !== task.task_id || value.case_id !== task.case_id || value.title !== task.title || typeof value.done !== 'boolean' || value.done !== (changesDate ? task.done : action === 'complete') || value.due_date !== (changesDate ? newDate : task.due_date) || (action === 'complete' && (typeof value.completed_at !== 'string' || !Number.isFinite(Date.parse(value.completed_at)))) || (action === 'reopen' && value.completed_at !== null)) throw new Error('The reply did not confirm this exact task change.');
      if (mounted.current) onChanged(true);
    } catch (err) {
      if (mounted.current) { setError(getApiErrorMessage(err, 'The task change could not be confirmed.')); onChanged(false); }
    } finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review assigned task change" className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
    <h2 className="text-lg font-semibold text-surface-100">{review ? 'Confirm one checklist change' : 'Edit an assigned task'}</h2>
    <p className="break-words text-sm text-surface-100">Task #{task.task_id}: {task.title}</p><p className="break-words text-sm text-surface-300">Investigation #{task.case_id}: {task.case_title} · {task.case_status.replaceAll('_', ' ')}</p>
    <p className="text-xs text-surface-400">Reviewed state: {task.done ? 'completed' : 'open'} · Task due date: {task.due_date ?? 'not set'}. This is one recorded checklist task, not external remediation or proof that work ran. Investigation status, investigation due date, assignment and other tasks stay unchanged. The save is refused if the reviewed title, completion, due date, investigation title/status or your assignment changed.</p>
    {['closed', 'resolved', 'false_positive'].includes(task.case_status) && <p className="text-xs text-warning">This investigation is inactive. Editing this checklist task does not reopen the investigation.</p>}
    {!review && <><label className="block space-y-2 text-sm text-surface-200">Task action<select aria-label="Assigned task action" className={`${control} block w-full`} value={action} onChange={event => setAction(event.target.value)}><option value={task.done ? 'reopen' : 'complete'}>{task.done ? 'Reopen this checklist task' : 'Mark this checklist task complete'}</option><option value="set_due">Set task due date</option><option value="clear_due">Clear task due date</option></select></label>{action === 'set_due' && <label className="block space-y-2 text-sm text-surface-200">New task due date<input type="date" aria-label="New assigned task due date" className={`${control} block`} value={date} onChange={event => setDate(event.target.value)} /></label>}</>}
    {review && <p className="break-words rounded border border-warning/40 p-3 text-sm text-warning">{changesDate ? `Change task #${task.task_id} due date from ${task.due_date ?? 'not set'} to ${newDate ?? 'not set'}. Completion stays ${task.done ? 'completed' : 'open'}.` : `${action === 'complete' ? 'Complete' : 'Reopen'} only task #${task.task_id}. ${action === 'complete' ? 'The server will record a completion timestamp.' : 'The saved completion timestamp will be cleared.'} Task due date stays ${task.due_date ?? 'not set'}.`}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error} Close this review and refresh the full workload before reviewing another change. No automatic retry was sent.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy} onClick={onClose}>{error ? 'Close and refresh workload' : 'Cancel'}</button>{!error && (review ? <><button className={control} type="button" disabled={busy} onClick={() => setReview(false)}>Back to task action</button><button className={control} type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Saving task change...' : 'Confirm task change'}</button></> : <button className={control} type="button" disabled={!valid} onClick={() => setReview(true)}>Review task change</button>)}</div>
  </div></div>;
}
