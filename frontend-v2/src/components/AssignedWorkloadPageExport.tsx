import { useRef } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { workloadPageCsv, type WorkloadPageSnapshot } from '../utils/assignedWorkloadExport';
const control = 'max-w-full rounded border border-surface-700 px-3 py-2 text-xs text-surface-200';
export function AssignedWorkloadPageExport({ snapshot, onClose }: { snapshot: WorkloadPageSnapshot; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null); useDialogFocus(ref, onClose); const f = snapshot.filters;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><section ref={ref} role="dialog" aria-modal="true" aria-label="Review assigned workload page export" className="max-h-[90dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h3 className="text-lg font-semibold">Review assigned workload page export</h3>
    <p className="text-sm">Only page {snapshot.page}: {snapshot.tasks.length} loaded task records of {snapshot.total} matching at that read. Page size 25. Other pages are not included. Loaded {snapshot.loadedAt}; captured locally {snapshot.capturedAt}.</p>
    <p className="text-xs text-warning">This freezes loaded records, not freshly fetched state, the full workload or complete audit history. Current assignments and records can change. Completion is not remediation proof. A due date does not prove a completed task was late. Titles, IDs and search text may be sensitive. Review before sharing. Downloading sends no message, upload, access grant or task save.</p>
    <p className="text-xs">Applied filters: query {JSON.stringify(f.query)}; severity {f.severity}; due {f.due}{f.due === 'range' ? ` (${f.dueFrom} through ${f.dueThrough}, inclusive)` : ''}; calendar date {f.today}; completion {f.completion}; investigations {f.investigations}{f.investigationId != null ? `; exact investigation #${f.investigationId}` : ''}. Draft edits are not included.</p>
    <ul aria-label="Workload page export task review" className="max-h-72 space-y-2 overflow-y-auto text-sm">{snapshot.tasks.map(task => <li key={task.task_id} className="rounded border border-surface-700 p-2">Task #{task.task_id}: {task.title}<p className="text-xs">Investigation #{task.case_id}: {task.case_title} · {task.case_severity} · {task.case_status} · {task.done ? 'Completed' : 'Open'} · Recorded completion {task.completed_at || 'not recorded'} · Task due {task.due_date || 'not set'} · Investigation due {task.case_due_date || 'not set'}</p></li>)}</ul>
    <button type="button" className={control} onClick={() => { const url = URL.createObjectURL(new Blob([workloadPageCsv(snapshot)], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `assigned-workload-page-${snapshot.page}.csv`; link.click(); URL.revokeObjectURL(url); }}>Download reviewed workload page CSV ({snapshot.tasks.length} records)</button>
    <button type="button" className={control} onClick={onClose}>Cancel workload page export</button>
  </section></div>;
}
