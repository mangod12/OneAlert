import { useEffect, useRef, useState, type ReactNode } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { validTaskDate } from '../utils/checklistTriage';
import { verifiedChecklistPatch, type BatchTask, type ChecklistPatch } from '../utils/checklistBatch';
import { ConfirmDialog } from './ui/ConfirmDialog';
const control = 'max-w-full rounded border border-surface-700 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
interface Selection { selected: Set<number>; toggle: (id: number) => void; select: (ids: number[]) => void; busy: boolean; }
interface Props { readOnly?: boolean; caseId: number; tasks: BatchTask[]; members: { id: number; full_name: string | null; email: string }[]; externalBusy: boolean; onRefresh?: () => void; onBusyChange: (busy: boolean) => void; onSaved: (tasks: BatchTask[]) => void; children: (selection: Selection) => ReactNode; }
export function ChecklistBatchTools({ readOnly = false, caseId, tasks, members, externalBusy, onRefresh, onBusyChange, onSaved, children }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState('complete'), [date, setDate] = useState(''), [assignee, setAssignee] = useState('');
  const [review, setReview] = useState<{ tasks: BatchTask[]; patch: ChecklistPatch; label: string } | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [errors, setErrors] = useState<Record<number, string>>({});
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setReview(null); }, [tasks, readOnly]);
  const chosen = tasks.filter(task => selected.has(task.id));
  const blocked = readOnly || busy || externalBusy;
  const valid = action !== 'date' || validTaskDate(date);
  const assignmentValid = action !== 'assign' || members.some(member => member.id === Number(assignee));
  const select = (ids: number[]) => { if (!blocked) setSelected(current => new Set([...current, ...ids.filter(id => tasks.some(task => task.id === id))].slice(0, 100))); };
  const prepare = () => {
    if (blocked || !chosen.length || chosen.length > 100 || !valid || !assignmentValid) return;
    const patch: ChecklistPatch = action === 'complete' || action === 'reopen' ? { done: action === 'complete' } : action === 'date' || action === 'clear_date' ? { due_date: action === 'date' ? date : null } : { assignee_id: action === 'assign' ? Number(assignee) : null };
    const label = action === 'complete' ? 'Mark complete' : action === 'reopen' ? 'Reopen' : action === 'date' ? `Set due date to ${date}` : action === 'clear_date' ? 'Clear task due dates' : action === 'assign' ? `Assign to ${members.find(member => member.id === Number(assignee))?.full_name || members.find(member => member.id === Number(assignee))?.email}` : 'Remove task assignees';
    setReview({ tasks: [...chosen], patch, label });
  };
  const apply = async () => {
    if (readOnly || !review || lock.current || externalBusy) return;
    lock.current = true; setBusy(true); onBusyChange(true); setNotice(''); setErrors({});
    const snapshot = review, saved: BatchTask[] = [], failures: Record<number, string> = {};
    for (let index = 0; index < snapshot.tasks.length; index += 3) {
      if (!mounted.current) break;
      await Promise.all(snapshot.tasks.slice(index, index + 3).map(async task => {
        try {
          const response = await apiClient.patch(`/cases/${caseId}/tasks/${task.id}`, snapshot.patch);
          saved.push(verifiedChecklistPatch(response.data, task.id, caseId, snapshot.patch));
        } catch (error) { failures[task.id] = getApiErrorMessage(error, 'Change unconfirmed. Refresh before retrying.'); }
      }));
    }
    if (mounted.current) {
      onSaved(saved);
      setSelected(current => new Set([...current].filter(id => !saved.some(task => task.id === id))));
      setErrors(failures); setNotice(`Confirmed changes for ${saved.length} of ${snapshot.tasks.length} reviewed tasks. ${Object.keys(failures).length ? 'Failed or unconfirmed tasks remain selected. Refresh the checklist before retrying.' : 'No investigation status or response plan was changed. Reload the investigation to refresh its timeline.'}`);
      setReview(null); setBusy(false);
    }
    onBusyChange(false); lock.current = false;
  };
  return <>
    {!readOnly && <section aria-label="Review selected checklist changes" className="mb-4 space-y-3 rounded border border-surface-700 p-3">
      <h3 className="text-sm font-semibold text-surface-100">Change selected checklist tasks</h3>
      <p className="text-xs text-surface-400">Select up to 100 loaded tasks across checklist pages or filters. Selection can include hidden tasks. Review every selected task before applying. Changes use individual task saves, not an atomic batch. Other people may edit records during review.</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-surface-200">{chosen.length} selected loaded tasks{selected.size > chosen.length ? `; ${selected.size - chosen.length} no longer loaded and excluded` : ''}</span><button type="button" className={control} disabled={blocked || !selected.size} onClick={() => setSelected(new Set())}>Clear checklist selection</button></div>
      {chosen.length > 0 && <>
        <ul aria-label="Selected checklist task review" tabIndex={0} className="max-h-52 space-y-2 overflow-y-auto rounded border border-surface-800 p-3 text-xs text-surface-300">{chosen.map(task => <li key={task.id} className="break-words">#{task.id}: {task.title} · {task.done ? 'Completed' : 'Open'} · {task.assignee_id === null ? 'Unassigned' : `Assignee #${task.assignee_id}`} · Due {task.due_date || 'not set'}</li>)}</ul>
        <div className="flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1 text-xs text-surface-400">Selected task action<select aria-label="Selected checklist action" className={control} value={action} disabled={blocked} onChange={event => { setAction(event.target.value); setReview(null); }}>{[['complete', 'Mark complete'], ['reopen', 'Reopen'], ['date', 'Set due date'], ['clear_date', 'Clear due date'], ['assign', 'Assign to member'], ['unassign', 'Remove assignee']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          {action === 'date' && <label className="flex flex-col gap-1 text-xs text-surface-400">Task due date<input type="date" aria-label="Selected checklist due date" className={control} disabled={blocked} value={date} onChange={event => { setDate(event.target.value); setReview(null); }} /></label>}
          {action === 'assign' && <label className="flex flex-col gap-1 text-xs text-surface-400">Task assignee<select aria-label="Selected checklist assignee" className={control} disabled={blocked} value={assignee} onChange={event => { setAssignee(event.target.value); setReview(null); }}><option value="">Choose member</option>{members.map(member => <option key={member.id} value={member.id}>{member.full_name || member.email}</option>)}</select></label>}
          <button type="button" className={control} disabled={blocked || !valid || !assignmentValid} onClick={prepare}>Review selected checklist change</button>
        </div>
      </>}
      {notice && <p role={Object.keys(errors).length ? 'alert' : 'status'} className="text-sm text-surface-200">{notice}</p>}
      {notice && onRefresh && <button type="button" className={control} disabled={blocked} onClick={onRefresh}>Reload investigation to verify results (clears selection)</button>}
      {Object.keys(errors).length > 0 && <ul className="space-y-1 text-xs text-danger">{Object.entries(errors).map(([id, error]) => <li key={id}>Task #{id}: {error}</li>)}</ul>}
    </section>}
    {children({ selected, select, toggle: id => { if (!blocked) setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 100) next.add(id); return next; }); }, busy: busy || readOnly })}
    {review && <ConfirmDialog title="Apply reviewed checklist change" description={`${review.label} for exactly ${review.tasks.length} selected tasks: ${review.tasks.slice(0, 12).map(task => `#${task.id}`).join(', ') + (review.tasks.length > 12 ? ` and ${review.tasks.length - 12} more in the selection preview` : '')}. The selection includes tasks hidden by filters or on other pages. Only the chosen field changes. Checklist completion is not response execution or proof of remediation. This cannot be cancelled once saves start.`} confirmLabel={`Apply to ${review.tasks.length} reviewed tasks`} busy={busy} onCancel={() => { if (!lock.current) setReview(null); }} onConfirm={() => void apply()} />}
  </>;
}
