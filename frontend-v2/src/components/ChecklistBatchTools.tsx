import { checklistOutcomeCsv, checklistOutcomeReceipt, type ChecklistOutcomeReceipt } from '../utils/checklistOutcomeReceipt';
import { useDialogFocus } from './ui/useDialogFocus';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { checkedBatchReview, saveReviewedBatchTask, taskChangeEndpoint, type ReviewedBatchTask } from '../utils/reviewedChecklistBatch';
import { validTaskDate } from '../utils/checklistTriage';
import { type BatchTask, type ChecklistPatch } from '../utils/checklistBatch';
const control = 'max-w-full rounded border border-surface-700 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
interface Selection { selected: Set<number>; toggle: (id: number) => void; select: (ids: number[]) => void; busy: boolean; }
interface Props { readOnly?: boolean; caseId: number; tasks: BatchTask[]; members: { id: number; full_name: string | null; email: string }[]; externalBusy: boolean; onRefresh?: () => void; onBusyChange: (busy: boolean) => void; onSaved: (tasks: BatchTask[]) => void; children: (selection: Selection) => ReactNode; }
export function ChecklistBatchTools({ readOnly = false, caseId, tasks, members, externalBusy, onRefresh, onBusyChange, onSaved, children }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState('complete'), [date, setDate] = useState(''), [assignee, setAssignee] = useState('');
  const [review, setReview] = useState<{ tasks: BatchTask[]; patch: ChecklistPatch; label: string; rows: ReviewedBatchTask[]; account: ReturnType<typeof checkedTaskAccount> } | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [errors, setErrors] = useState<Record<number, string>>({});
  const lock = useRef(false), mounted = useRef(true);
  const [receipt, setReceipt] = useState<ChecklistOutcomeReceipt | null>(null);
  const [stopped, setStopped] = useState(false);
  const version = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { version.current += 1; setReview(null); }, [tasks, readOnly]);
  const chosen = tasks.filter(task => selected.has(task.id));
  const blocked = readOnly || busy || externalBusy || stopped;
  const valid = action !== 'date' || validTaskDate(date);
  const assignmentValid = action !== 'assign' || members.some(member => member.id === Number(assignee));
  const select = (ids: number[]) => { if (!blocked) setSelected(current => new Set([...current, ...ids.filter(id => tasks.some(task => task.id === id))].slice(0, 100))); };
  const prepare = async () => {
    if (lock.current || blocked || !chosen.length || chosen.length > 100 || !valid || !assignmentValid) return;
    const patch: ChecklistPatch = action === 'complete' || action === 'reopen' ? { done: action === 'complete' } : action === 'date' || action === 'clear_date' ? { due_date: action === 'date' ? date : null } : { assignee_id: action === 'assign' ? Number(assignee) : null };
    const label = action === 'complete' ? 'Mark complete' : action === 'reopen' ? 'Reopen' : action === 'date' ? `Set due date to ${date}` : action === 'clear_date' ? 'Clear task due dates' : action === 'assign' ? `Assign to ${members.find(member => member.id === Number(assignee))?.full_name || members.find(member => member.id === Number(assignee))?.email}` : 'Remove task assignees';
    const selected = chosen.filter(task => Object.entries(patch).some(([key, value]) => task[key as keyof BatchTask] !== value));
    if (!selected.length) { setNotice('Every selected task already has this value. No saves were sent.'); return; }
    lock.current = true; setBusy(true); onBusyChange(true); setNotice(''); setErrors({}); const started = version.current;
    try {
      const account = checkedTaskAccount((await apiClient.get('/auth/me')).data), rows: ReviewedBatchTask[] = [];
      for (const task of selected) {
        if (!mounted.current || version.current !== started) return;
        const response = await apiClient.post(`/cases/${caseId}/tasks/${task.id}/${taskChangeEndpoint(patch)}-review`, patch);
        rows.push(checkedBatchReview(response.data, task, caseId, patch, account));
      }
      if (mounted.current && version.current === started) setReview({ tasks: [...selected], patch, label, rows, account });
    } catch { if (mounted.current) { setNotice('The complete selected task review could not be verified. No saves were sent. Reload the investigation before trying again.'); setStopped(true); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); onBusyChange(false); }
  };
  const apply = async () => {
    if (readOnly || !review || lock.current || externalBusy) return;
    lock.current = true; setBusy(true); onBusyChange(true); setNotice(''); setErrors({});
    const snapshot = review, saved: BatchTask[] = [], failures: Record<number, string> = {}, attempted = new Set<number>();
    const started = version.current;
    try {
      const account = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (JSON.stringify(account) !== JSON.stringify(snapshot.account)) throw Error('Account changed');
      for (const row of snapshot.rows) {
        if (!mounted.current || version.current !== started) break;
        attempted.add(row.task.id);
        try { saved.push(await saveReviewedBatchTask(row, caseId)); }
        catch { failures[row.task.id] = 'Change unconfirmed and may already have applied. No retry or further task saves were sent. Reload the investigation to verify.'; break; }
      }
    } catch { failures[snapshot.tasks[0].id] = 'The acting account changed or could not be verified. No task saves were sent.'; }
    if (mounted.current) {
      setReceipt(checklistOutcomeReceipt(caseId, snapshot.account, snapshot.label, snapshot.tasks, saved, attempted, new Date().toISOString()));
      onSaved(saved);
      setSelected(current => new Set([...current].filter(id => !saved.some(task => task.id === id))));
      setStopped(Object.keys(failures).length > 0); setErrors(failures); setNotice(`Confirmed changes for ${saved.length} of ${snapshot.tasks.length} reviewed tasks. ${Object.keys(failures).length ? 'Stopped at an unconfirmed change. Remaining tasks were not attempted. Reload the checklist before another review.' : 'No investigation status or response plan was changed. Reload the investigation to refresh its timeline.'}`);
      setReview(null); setBusy(false);
    }
    onBusyChange(false); lock.current = false;
  };
  return <>
    {!readOnly && <section aria-label="Review selected checklist changes" className="mb-4 space-y-3 rounded border border-surface-700 p-3">
      <h3 className="text-sm font-semibold text-surface-100">Change selected checklist tasks</h3>
      <p className="text-xs text-surface-400">Select up to 100 loaded tasks across checklist pages or filters. Selection can include hidden tasks. Review every selected task before applying. Changes use individual task saves, not an atomic batch. Fresh saved task evidence is checked before review and again during each save. Changes are sequential and stop at the first unconfirmed result.</p>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-surface-200">{chosen.length} selected loaded tasks{selected.size > chosen.length ? `; ${selected.size - chosen.length} no longer loaded and excluded` : ''}</span><button type="button" className={control} disabled={blocked || !selected.size} onClick={() => setSelected(new Set())}>Clear checklist selection</button></div>
      {chosen.length > 0 && <>
        <ul aria-label="Selected checklist task review" tabIndex={0} className="max-h-52 space-y-2 overflow-y-auto rounded border border-surface-800 p-3 text-xs text-surface-300">{chosen.map(task => <li key={task.id} className="break-words">#{task.id}: {task.title} · {task.done ? 'Completed' : 'Open'} · {task.assignee_id === null ? 'Unassigned' : `Assignee #${task.assignee_id}`} · Due {task.due_date || 'not set'}</li>)}</ul>
        <div className="flex flex-wrap items-end gap-2"><label className="flex flex-col gap-1 text-xs text-surface-400">Selected task action<select aria-label="Selected checklist action" className={control} value={action} disabled={blocked} onChange={event => { setAction(event.target.value); setReview(null); }}>{[['complete', 'Mark complete'], ['reopen', 'Reopen'], ['date', 'Set due date'], ['clear_date', 'Clear due date'], ['assign', 'Assign to member'], ['unassign', 'Remove assignee']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          {action === 'date' && <label className="flex flex-col gap-1 text-xs text-surface-400">Task due date<input type="date" aria-label="Selected checklist due date" className={control} disabled={blocked} value={date} onChange={event => { setDate(event.target.value); setReview(null); }} /></label>}
          {action === 'assign' && <label className="flex flex-col gap-1 text-xs text-surface-400">Task assignee<select aria-label="Selected checklist assignee" className={control} disabled={blocked} value={assignee} onChange={event => { setAssignee(event.target.value); setReview(null); }}><option value="">Choose member</option>{members.map(member => <option key={member.id} value={member.id}>{member.full_name || member.email}</option>)}</select></label>}
          <button type="button" className={control} disabled={blocked || !valid || !assignmentValid} onClick={() => void prepare()}>Review selected checklist change</button>
        </div>
      </>}
      {receipt && <section aria-label="Reviewed checklist save receipt" className="space-y-3 rounded border border-surface-700 p-3 [overflow-wrap:anywhere]"><h4 className="text-sm font-semibold">Checklist save receipt</h4><p className="text-xs">Investigation #{receipt.caseId} · {receipt.action} · Acting account #{receipt.account.id}: {receipt.account.email} · Recorded {receipt.recordedAt}</p><p className="text-xs text-warning">This records local save responses, not current state, complete audit history, notification delivery or remediation. Unconfirmed changes may already have applied. Not attempted means this batch sent no save for that task. The receipt lasts only in this open workspace; export before leaving if you need a copy.</p><ul aria-label="Task save outcomes" className="max-h-72 space-y-2 overflow-y-auto text-sm">{receipt.rows.map(row => <li key={row.id} className="rounded border border-surface-700 p-2">#{row.id}: {row.title} · {row.outcome === 'confirmed' ? 'Confirmed' : row.outcome === 'unconfirmed' ? 'Unconfirmed, may have applied' : 'Not attempted'}{row.after && <p className="text-xs">Confirmed response: {row.after.done ? 'Completed' : 'Open'} · Due {row.after.due_date ?? 'not set'} · {row.after.assignee_id === null ? 'Unassigned' : `Assignee #${row.after.assignee_id}`}</p>}</li>)}</ul><button className={control} disabled={busy} onClick={() => { const blob = new Blob([checklistOutcomeCsv(receipt)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `investigation-${receipt.caseId}-checklist-save-receipt.csv`; link.click(); URL.revokeObjectURL(url); }}>Export checklist save receipt CSV</button></section>}
      {notice && <p role={Object.keys(errors).length ? 'alert' : 'status'} className="text-sm text-surface-200">{notice}</p>}
      {notice && onRefresh && <button type="button" className={control} disabled={busy || externalBusy} onClick={() => { setSelected(new Set()); setReview(null); setStopped(false); setNotice(''); setErrors({}); onRefresh(); }}>Reload investigation to verify results (clears selection)</button>}
      {Object.keys(errors).length > 0 && <ul className="space-y-1 text-xs text-danger">{Object.entries(errors).map(([id, error]) => <li key={id}>Task #{id}: {error}</li>)}</ul>}
    </section>}
    {children({ selected, select, toggle: id => { if (!blocked) setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 100) next.add(id); return next; }); }, busy: busy || readOnly })}
    {review && <BatchReviewDialog busy={busy} onClose={() => { if (!lock.current) setReview(null); }}><h3 className="text-lg font-semibold">Apply reviewed checklist change</h3><p className="text-sm">{review.label} for exactly {review.tasks.length} selected tasks. Acting account #{review.account.id}: {review.account.email}. Selection can include hidden tasks. No response action runs. These are separate sequential saves, not one atomic batch. On an unconfirmed result, later tasks are not attempted and no automatic retry is sent.</p><ul className="space-y-3 text-sm">{review.rows.map(row => <li key={row.task.id} className="rounded border border-surface-700 p-3"><p>Investigation #{caseId}: {row.caseTitle}</p><p>#{row.task.id}: {row.task.title}</p><p>{row.task.done ? 'Completed' : 'Open'} · Due {row.task.due_date ?? 'not set'} · {row.task.assignee_id === null ? 'Unassigned' : `Assignee #${row.task.assignee_id}`}</p><p>{row.effects}</p></li>)}</ul><button className={control} disabled={busy} onClick={() => void apply()}>Apply to {review.tasks.length} reviewed tasks</button><button className={control} disabled={busy} onClick={() => setReview(null)}>Cancel</button></BatchReviewDialog>}

  </>;
}

function BatchReviewDialog({ busy, onClose, children }: { busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null); useDialogFocus(dialog, () => { if (!busy) onClose(); });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={dialog} role="dialog" aria-modal="true" aria-label="Apply reviewed checklist change" className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">{children}</section></div>;
}
