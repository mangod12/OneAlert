import { readChecklistFilterLink } from '../utils/checklistFilterLink';
import { ChecklistFilterHandoff } from './ChecklistFilterHandoff';
import { ChecklistSnapshotExport } from './ChecklistSnapshotExport';
import { checklistExportSnapshot, type ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
import { checklistWorkload } from '../utils/checklistWorkload';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultChecklistFilters, filterChecklist, validTaskDate, type ChecklistTask } from '../utils/checklistTriage';
const control = 'max-w-full rounded border border-surface-700 bg-surface-950 px-2 py-2 text-xs text-surface-300';
export function ChecklistTriage<T extends ChecklistTask>({ initialSearch = '', caseId, tasks, today, currentUserId, members, children, linkedTaskId = null, onSelectMatching, selectionBusy = false }: { initialSearch?: string; caseId?: number; onSelectMatching?: (ids: number[]) => void; selectionBusy?: boolean; linkedTaskId?: number | null; tasks: T[]; today: string; currentUserId: number | null; members: { id: number; full_name: string | null; email: string }[]; children: (task: T) => ReactNode }) {
  const [incoming] = useState(() => readChecklistFilterLink(initialSearch));
  const [invalidLink, setInvalidLink] = useState(incoming.invalid);
  const [exportSnapshot, setExportSnapshot] = useState<ChecklistExportSnapshot | null>(null);
  const linkedIndex = filterChecklist(tasks, defaultChecklistFilters, today, currentUserId).findIndex(task => task.id === linkedTaskId);
  const [filters, setFilters] = useState(incoming.invalid ? { ...defaultChecklistFilters } : incoming.filters), [page, setPage] = useState(() => linkedIndex < 0 ? 1 : Math.floor(linkedIndex / 20) + 1);
  const [reveal, setReveal] = useState(0), revealed = useRef('');
  useEffect(() => {
    const key = `${linkedTaskId}:${reveal}`;
    if (linkedTaskId === null || linkedIndex < 0 || revealed.current === key) return;
    const element = document.getElementById(`case-task-${linkedTaskId}`);
    if (element) { element.scrollIntoView?.({ block: 'center' }); element.focus({ preventScroll: true }); revealed.current = key; }
  }, [linkedTaskId, linkedIndex, reveal, page]);
  const filtered = invalidLink ? [] : filterChecklist(tasks, filters, today, currentUserId);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, totalPages);
  const update = (key: keyof typeof filters, value: string) => { setInvalidLink(false); setFilters(values => ({ ...values, [key]: value })); setPage(1); };
  const workload = checklistWorkload(tasks, today);
  const overdue = tasks.filter(task => !task.done && validTaskDate(today) && validTaskDate(task.due_date) && task.due_date < today).length;
  const assignees = new Set(tasks.map(task => task.assignee_id).filter((id): id is number => id != null));
  const active = invalidLink || Object.keys(defaultChecklistFilters).some(key => filters[key as keyof typeof filters] !== defaultChecklistFilters[key as keyof typeof filters]);
  return <section aria-label="Investigation checklist triage" className="mb-4 space-y-3">
    {invalidLink && <p role="alert" className="text-sm text-danger">The checklist filter link is invalid or ambiguous. No matching tasks, batch selection or export is available from this link. Clear task filters or explicitly choose a new filter to continue. No task was changed.</p>}
    {linkedTaskId !== null && (linkedIndex < 0 ? <p role="alert" className="text-sm text-warning">Task #{linkedTaskId} is not in this loaded investigation checklist. It may have been removed or may belong to another investigation. No task was changed.</p> : <div className="flex flex-wrap items-center gap-2 text-xs text-primary-300"><span>Linked task #{linkedTaskId} is in this checklist. Filters may hide it.</span><button type="button" className={control} onClick={() => { setInvalidLink(false); setFilters({ ...defaultChecklistFilters }); setPage(Math.floor(linkedIndex / 20) + 1); setReveal(value => value + 1); }}>Show linked task #{linkedTaskId}</button></div>)}
    <p className="text-xs text-surface-400">{tasks.length} total tasks · {tasks.filter(task => !task.done).length} open · {overdue} overdue open · {tasks.filter(task => task.assignee_id == null).length} unassigned. Progress above always covers the whole checklist.</p>
    <details className="rounded border border-surface-700 p-3 [overflow-wrap:anywhere]">
      <summary className="cursor-pointer text-sm font-semibold text-surface-200">Checklist workload by assignee</summary>
      <p className="my-2 text-xs text-surface-400">Counts cover all loaded checklist tasks, not the current filters or page. Completion is checklist state, not remediation proof. Assigned members may no longer be in the member list. No task or assignment changes here.</p>
      {!validTaskDate(today) && <p className="text-xs text-warning">The local date is unavailable. Overdue, today and later counts are unknown, not zero.</p>}
      <ul aria-label="Assignee checklist workload" className="max-h-80 space-y-2 overflow-y-auto">{workload.map(row => {
        const member = members.find(person => person.id === row.assigneeId);
        const label = row.assigneeId === null ? 'Unassigned' : `${member?.full_name || member?.email || 'Member'} (#${row.assigneeId})`;
        return <li key={row.assigneeId ?? 'unassigned'} className="space-y-1 rounded border border-surface-800 p-2 text-xs text-surface-300"><p className="font-semibold">{label}</p><p>{row.open} open · {row.completed} completed · {row.total} total</p><p>{validTaskDate(today) ? `${row.overdue} overdue open · ${row.today} due today open · ${row.later} due later open` : 'Date-based counts unknown'} · {row.undated} open without a valid due date</p><button type="button" className={control} disabled={!row.open} onClick={() => { setInvalidLink(false); setFilters({ ...defaultChecklistFilters, status: 'open', assignee: row.assigneeId === null ? 'unassigned' : String(row.assigneeId), sort: 'due' }); setPage(1); }}>Show open tasks: {label}</button></li>;
      })}</ul>
      <p className="mt-2 text-xs text-surface-500">Show open tasks replaces title, status, assignee, due-date and order filters, then opens page 1. Selection is unchanged and may include hidden tasks. Nothing is saved.</p>
    </details>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-surface-400 sm:basis-56 sm:flex-1">Search task titles<input aria-label="Search investigation task titles" className={control} value={filters.query} onChange={event => update('query', event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Task status<select aria-label="Filter checklist task status" className={control} value={filters.status} onChange={event => update('status', event.target.value)}><option value="all">All tasks</option><option value="open">Open tasks</option><option value="done">Completed tasks</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Assigned to<select aria-label="Filter checklist assignee" className={control} value={filters.assignee} onChange={event => update('assignee', event.target.value)}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{currentUserId !== null && <option value="mine">Assigned to me</option>}{/^[1-9][0-9]*$/.test(filters.assignee) && !assignees.has(Number(filters.assignee)) && <option value={filters.assignee}>Member #{filters.assignee} (not in loaded tasks)</option>}{[...assignees].sort((a, b) => a - b).map(id => { const member = members.find(person => person.id === id); return <option key={id} value={id}>{member?.full_name || member?.email || `Member #${id}`}</option>; })}</select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Due date<select aria-label="Filter checklist due date" className={control} value={filters.due} onChange={event => update('due', event.target.value)}><option value="all">Any due date</option><option value="overdue">Overdue open</option><option value="today">Due today, open</option><option value="upcoming">Due later, open</option><option value="undated">No valid due date</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Order<select aria-label="Sort investigation tasks" className={control} value={filters.sort} onChange={event => update('sort', event.target.value)}><option value="position">Checklist order</option><option value="due">Due date first</option><option value="title">Title A to Z</option></select></label>
      {active && <button type="button" className={control} onClick={() => { setInvalidLink(false); setFilters({ ...defaultChecklistFilters }); setPage(1); }}>Clear task filters</button>}
    </div>
    <p className="text-xs text-surface-500">Due filters use your device's local date{today ? ` (${today})` : ''}. Overdue, today and later include open tasks only. Filters and sorting change the view, never saved task order or state.</p>
    {onSelectMatching && <button type="button" className={control} disabled={selectionBusy || !filtered.length} onClick={() => onSelectMatching(filtered.map(task => task.id))}>Select matching checklist tasks (up to 100)</button>}
    {caseId !== undefined && <ChecklistFilterHandoff caseId={caseId} filters={filters} currentUserId={currentUserId} disabled={invalidLink || selectionBusy} />}
    {caseId !== undefined && <button type="button" className={control} disabled={selectionBusy || !filtered.length} onClick={() => setExportSnapshot(checklistExportSnapshot(caseId, filtered, tasks.length, filters, today, new Date().toISOString()))}>Review matching checklist CSV ({filtered.length} tasks)</button>}
    {exportSnapshot && <ChecklistSnapshotExport snapshot={exportSnapshot} onClose={() => setExportSnapshot(null)} />}
    {!filtered.length && <p role="status" className="text-sm text-surface-400">No tasks match these filters. Clear task filters to see the whole checklist.</p>}
    <ul className="space-y-1.5">{filtered.slice((currentPage - 1) * 20, currentPage * 20).map(children)}</ul>
    <nav aria-label="Checklist task pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous task page</button><span>{filtered.length ? (currentPage - 1) * 20 + 1 : 0}–{Math.min(currentPage * 20, filtered.length)} of {filtered.length} matching tasks · Page {currentPage} of {totalPages}</span><button type="button" className={control} disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next task page</button></nav>
  </section>;
}
