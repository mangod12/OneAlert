import { useState, type ReactNode } from 'react';
import { defaultChecklistFilters, filterChecklist, validTaskDate, type ChecklistTask } from '../utils/checklistTriage';
const control = 'max-w-full rounded border border-surface-700 bg-surface-950 px-2 py-2 text-xs text-surface-300';
export function ChecklistTriage<T extends ChecklistTask>({ tasks, today, currentUserId, members, children }: { tasks: T[]; today: string; currentUserId: number | null; members: { id: number; full_name: string | null; email: string }[]; children: (task: T) => ReactNode }) {
  const [filters, setFilters] = useState({ ...defaultChecklistFilters }), [page, setPage] = useState(1);
  const filtered = filterChecklist(tasks, filters, today, currentUserId);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, totalPages);
  const update = (key: keyof typeof filters, value: string) => { setFilters(values => ({ ...values, [key]: value })); setPage(1); };
  const overdue = tasks.filter(task => !task.done && validTaskDate(today) && validTaskDate(task.due_date) && task.due_date < today).length;
  const assignees = new Set(tasks.map(task => task.assignee_id).filter((id): id is number => id != null));
  const active = Object.keys(defaultChecklistFilters).some(key => filters[key as keyof typeof filters] !== defaultChecklistFilters[key as keyof typeof filters]);
  return <section aria-label="Investigation checklist triage" className="mb-4 space-y-3">
    <p className="text-xs text-surface-400">{tasks.length} total tasks · {tasks.filter(task => !task.done).length} open · {overdue} overdue open · {tasks.filter(task => task.assignee_id == null).length} unassigned. Progress above always covers the whole checklist.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-surface-400 sm:basis-56 sm:flex-1">Search task titles<input aria-label="Search investigation task titles" className={control} value={filters.query} onChange={event => update('query', event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Task status<select aria-label="Filter checklist task status" className={control} value={filters.status} onChange={event => update('status', event.target.value)}><option value="all">All tasks</option><option value="open">Open tasks</option><option value="done">Completed tasks</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Assigned to<select aria-label="Filter checklist assignee" className={control} value={filters.assignee} onChange={event => update('assignee', event.target.value)}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{currentUserId !== null && <option value="mine">Assigned to me</option>}{[...assignees].sort((a, b) => a - b).map(id => { const member = members.find(person => person.id === id); return <option key={id} value={id}>{member?.full_name || member?.email || `Member #${id}`}</option>; })}</select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Due date<select aria-label="Filter checklist due date" className={control} value={filters.due} onChange={event => update('due', event.target.value)}><option value="all">Any due date</option><option value="overdue">Overdue open</option><option value="today">Due today, open</option><option value="upcoming">Due later, open</option><option value="undated">No valid due date</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Order<select aria-label="Sort investigation tasks" className={control} value={filters.sort} onChange={event => update('sort', event.target.value)}><option value="position">Checklist order</option><option value="due">Due date first</option><option value="title">Title A to Z</option></select></label>
      {active && <button type="button" className={control} onClick={() => { setFilters({ ...defaultChecklistFilters }); setPage(1); }}>Clear task filters</button>}
    </div>
    <p className="text-xs text-surface-500">Due filters use your device's local date{today ? ` (${today})` : ''}. Overdue, today and later include open tasks only. Filters and sorting change the view, never saved task order or state.</p>
    {!filtered.length && <p role="status" className="text-sm text-surface-400">No tasks match these filters. Clear task filters to see the whole checklist.</p>}
    <ul className="space-y-1.5">{filtered.slice((currentPage - 1) * 20, currentPage * 20).map(children)}</ul>
    <nav aria-label="Checklist task pages" className="flex flex-wrap items-center gap-2 text-xs text-surface-300"><button type="button" className={control} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous task page</button><span>{filtered.length ? (currentPage - 1) * 20 + 1 : 0}–{Math.min(currentPage * 20, filtered.length)} of {filtered.length} matching tasks · Page {currentPage} of {totalPages}</span><button type="button" className={control} disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next task page</button></nav>
  </section>;
}
