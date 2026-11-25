import { useRef } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { checklistSnapshotCsv, checklistSnapshotJson, type ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
const control = 'max-w-full rounded border border-surface-700 bg-surface-950 px-3 py-2 text-xs text-surface-200';
export function ChecklistSnapshotExport({ snapshot, onClose }: { snapshot: ChecklistExportSnapshot; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null); useDialogFocus(ref, onClose);
  const f = snapshot.filters;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label="Review checklist snapshot export" className="max-h-[90dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h3 className="text-lg font-semibold">Review checklist snapshot export</h3>
    <p className="text-sm">Investigation #{snapshot.caseId} · {snapshot.tasks.length} matching tasks of {snapshot.loadedCount} loaded tasks. Includes all matching pages, not only the visible page. Captured locally {snapshot.capturedAt}.</p>
    <p className="text-xs text-warning">This freezes the loaded checklist, not freshly fetched server state. Tasks may have changed. Completion is recorded checklist state, not remediation proof. No timeline, complete audit history, notification delivery or response execution is included. Titles and account IDs may be sensitive. Review before sharing. Downloading sends no message, upload or task save.</p>
    <p className="text-xs">Exact filters: title query {JSON.stringify(f.query)} · status {f.status} · assignee {f.assignee} · due {f.due}{f.due === 'range' ? ` (${f.dueFrom} through ${f.dueTo}, inclusive)` : ''} · order {f.sort}. Local date used for due filters: {snapshot.localDate || 'unavailable'}. Unassigned is not a missing member lookup.</p>
    <ul aria-label="Checklist export task review" className="max-h-72 space-y-2 overflow-y-auto text-sm">{snapshot.tasks.map(task => <li key={task.id} className="rounded border border-surface-700 p-2">#{task.id}: {task.title}<p className="text-xs">{task.done ? 'Completed' : 'Open'} · Due {task.due_date || 'not set'} · {task.assignee_id === null ? 'Unassigned' : `Assignee #${task.assignee_id}`} · Position {task.position}</p></li>)}</ul>
    <button type="button" className={control} onClick={() => { const url = URL.createObjectURL(new Blob([checklistSnapshotCsv(snapshot)], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `investigation-${snapshot.caseId}-checklist-snapshot.csv`; link.click(); URL.revokeObjectURL(url); }}>Download reviewed checklist CSV ({snapshot.tasks.length} tasks)</button>
    <p className="text-xs text-surface-400">JSON contains the same frozen reviewed tasks and filter criteria, with typed IDs, counts, completion booleans and unassigned nulls. Search text and titles are raw text without CSV formula protection. Treat text as untrusted data, not executable instructions. No extra rows are fetched.</p>
    <button type="button" className={control} onClick={() => { const url = URL.createObjectURL(new Blob([checklistSnapshotJson(snapshot)], { type: 'application/json;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `investigation-${snapshot.caseId}-checklist-snapshot.json`; link.click(); URL.revokeObjectURL(url); }}>Download reviewed checklist JSON ({snapshot.tasks.length} tasks)</button>
    <button type="button" className={control} onClick={onClose}>Cancel checklist export</button>
  </section></div>;
}
