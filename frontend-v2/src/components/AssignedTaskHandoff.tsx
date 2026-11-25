import { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
interface TaskLinkRecord { task_id: number; case_id: number; title: string; case_title: string; done: boolean; due_date: string | null; completed_at: string | null; }
export function AssignedTaskHandoff({ task }: { task: TaskLinkRecord }) {
  const [review, setReview] = useState<TaskLinkRecord | null>(null);
  return <><button type="button" onClick={() => setReview({ ...task })} className="max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Review assigned task #{task.task_id} link</button>{review && <AssignedTaskLinkReview task={review} onClose={() => setReview(null)} />}</>;
}
function AssignedTaskLinkReview({ task, onClose }: { task: TaskLinkRecord; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null), active = useRef(true), pending = useRef(false);
  const [copying, setCopying] = useState(false), [notice, setNotice] = useState('');
  const close = () => { active.current = false; onClose(); };
  useDialogFocus(ref, close);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true; setCopying(true); setNotice('');
    try {
      const url = new URL(`/app/cases/${task.case_id}`, window.location.origin); url.searchParams.set('task', String(task.task_id));
      await navigator.clipboard.writeText(url.toString());
      if (active.current) setNotice('ID-only assigned task link copied. No message was sent, task changed or access granted.');
    } catch { if (active.current) setNotice('Copy unavailable. No message was sent or task changed. Retry copying or open the investigation from the workload results.'); }
    finally { pending.current = false; if (active.current) setCopying(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label={`Review assigned task #${task.task_id} link`} className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h3 className="text-lg font-semibold">Review assigned task link</h3>
    <p>Investigation #{task.case_id}: {task.case_title}</p><p>Task #{task.task_id}: {task.title}</p>
    <p>Loaded state: {task.done ? 'Completed' : 'Open'} · Task due: {task.due_date || 'Not set'} · Recorded completion: {task.completed_at || 'Not recorded'}</p>
    <p className="text-sm text-warning">These are frozen loaded workload details, not a fresh server read, assignment history or remediation proof. The link contains only investigation and task IDs, never these titles, dates, completion state, workload filters or credentials. IDs can still be sensitive. Share only with an appropriate audience.</p>
    <p className="text-sm text-surface-300">Opening the link reads current records with the viewer's own access. It grants no access, assigns no work and sends no notification. Removed or inaccessible tasks may not open. Copying never sends a message or changes a task.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={copying} onClick={() => void copy()} className="min-h-9 rounded border border-surface-600 px-3 py-2 text-sm text-primary-300 disabled:opacity-40">Copy ID-only assigned task link</button><button type="button" onClick={close} className="min-h-9 rounded border border-surface-600 px-3 py-2 text-sm">Close assigned task link review</button></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section></div>;
}
