import { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { type ChecklistTask } from '../utils/checklistTriage';
interface Props { caseId: number; task: ChecklistTask; }
export function ChecklistTaskHandoff({ caseId, task }: Props) {
  const [reviewing, setReviewing] = useState(false);
  return <><button type="button" className="max-w-full rounded border border-surface-700 px-2 py-1 text-xs text-primary-300" onClick={() => setReviewing(true)}>Review task #{task.id} link</button>{reviewing && <TaskLinkReview caseId={caseId} task={{ ...task }} onClose={() => setReviewing(false)} />}</>;
}
function TaskLinkReview({ caseId, task, onClose }: Props & { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null), active = useRef(true);
  const [snapshot] = useState(() => ({ caseId, task: { ...task } }));
  const [copying, setCopying] = useState(false), [notice, setNotice] = useState('');
  useDialogFocus(ref, () => { active.current = false; onClose(); });
  const close = () => { active.current = false; onClose(); };
  const copy = async () => {
    if (copying) return;
    setCopying(true); setNotice('');
    try {
      const url = new URL(`/app/cases/${snapshot.caseId}`, window.location.origin);
      url.searchParams.set('task', String(snapshot.task.id));
      await navigator.clipboard.writeText(url.toString());
      if (active.current) setNotice('ID-only task link copied. No message was sent and no access was granted.');
    } catch { if (active.current) setNotice('The link could not be copied. No message was sent. Try copying again.'); }
    finally { if (active.current) setCopying(false); }
  };
  const t = snapshot.task;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label={`Review task #${t.id} link`} className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h3 className="text-lg font-semibold">Review checklist task link</h3>
    <p className="text-sm">Investigation #{snapshot.caseId} · Task #{t.id}: {t.title}</p>
    <p className="text-sm">Loaded state: {t.done ? 'Completed' : 'Open'} · Due {t.due_date || 'not set'} · {t.assignee_id === null ? 'Unassigned' : `Assignee #${t.assignee_id}`}</p>
    <p className="text-xs text-warning">This review freezes loaded task details, not a fresh server read or remediation proof. The link contains only investigation and task IDs, never this title, assignment, due date, account credentials or other page filters. IDs can still be sensitive. Share only with an appropriate audience.</p>
    <p className="text-xs text-surface-300">Opening the link requires the viewer's own current access and reads current records. It grants no access, assigns no work and sends no notification. Removed or inaccessible tasks may not open. Copying never sends a message or changes a task.</p>
    <button type="button" disabled={copying} onClick={() => void copy()} className="rounded border border-surface-600 px-3 py-2 text-sm text-primary-300 disabled:opacity-40">Copy ID-only task link</button>
    <button type="button" onClick={close} className="rounded border border-surface-700 px-3 py-2 text-sm">Close task link review</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section></div>;
}
