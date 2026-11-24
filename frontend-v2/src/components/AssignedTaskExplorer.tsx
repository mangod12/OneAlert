import { SavedViewsMenu } from './SavedViewsMenu';
import { readWorkloadView, savedWorkloadFilters } from '../utils/assignedWorkloadViews';
import { AssignedWorkloadBreakdown } from './AssignedWorkloadBreakdown';
import { AssignedWorkloadPageExport } from './AssignedWorkloadPageExport';
import { workloadPageSnapshot, type WorkloadPageSnapshot } from '../utils/assignedWorkloadExport';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { validTaskDate } from '../utils/checklistTriage';
import { AssignedTaskEditor } from './AssignedTaskEditor';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Task { done: boolean; completed_at: string | null; task_id: number; case_id: number; title: string; case_title: string; case_severity: string; case_status: string; due_date: string | null; case_due_date: string | null; }
interface Summary { total: number; investigations: number; open: number; completed: number; without_due_date: number; completed_without_timestamp: number; }
function summaryFrom(value: unknown, total: number, completion: string): Summary | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Summary;
  if (![s.total, s.investigations, s.open, s.completed, s.without_due_date, s.completed_without_timestamp].every(n => Number.isSafeInteger(n) && n >= 0)
    || s.total !== total || s.open + s.completed !== total || s.investigations > total || (total > 0 && !s.investigations)
    || s.without_due_date > total || s.completed_without_timestamp > s.completed
    || (completion === 'open' && s.completed !== 0) || (completion === 'completed' && s.open !== 0)) return null;
  return s;
}
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function AssignedTaskExplorer({ onEdited, editingBlocked = false }: { onEdited?: () => void; editingBlocked?: boolean }) {
  const [exportSnapshot, setExportSnapshot] = useState<WorkloadPageSnapshot | null>(null);
  const [editing, setEditing] = useState<Task | null>(null), [notice, setNotice] = useState(''), [mustRefresh, setMustRefresh] = useState(false);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all'), [due, setDue] = useState('all'), [today, setToday] = useState(localDate);
  const [dueFrom, setDueFrom] = useState(''), [dueThrough, setDueThrough] = useState('');
  const [completion, setCompletion] = useState('open'), [investigations, setInvestigations] = useState('active');
  const [filters, setFilters] = useState({ query: '', severity: 'all', due: 'all', today: localDate(), completion: 'open', investigations: 'active', dueFrom: '', dueThrough: '', investigationId: null as number | null });
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{ tasks: Task[]; total: number; summary: Summary | null; loadedAt: string; groups: unknown; groupCount: unknown; groupLimit: unknown } | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setSnapshot(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get('/cases/assigned-task-explorer', { params: { query: filters.query, severity: filters.severity, due: filters.due, today: filters.today, completion: filters.completion, investigations: filters.investigations, ...(filters.investigationId === null ? {} : { investigation_id: filters.investigationId }), ...(filters.due === 'range' ? { due_from: filters.dueFrom, due_through: filters.dueThrough } : {}), page, size: 25 } }).then(response => {
      if (requestId.current !== request) return;
      const value = response.data;
      if ((filters.investigationId !== null && (value.investigation_id !== filters.investigationId || (Array.isArray(value.data) && value.data.some((task: Task) => task?.case_id !== filters.investigationId)))) || (filters.due === 'range' && (value.due_from !== filters.dueFrom || value.due_through !== filters.dueThrough || (Array.isArray(value.data) && value.data.some((task: Task) => !validTaskDate(task?.due_date) || task.due_date! < filters.dueFrom || task.due_date! > filters.dueThrough)))) || value.completion !== filters.completion || value.investigations !== filters.investigations || !Array.isArray(value.data) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page || value.size !== 25 || value.data.length > 25 || new Set(value.data.map((task: Task) => task?.task_id)).size !== value.data.length || value.filter_date !== filters.today || value.data.some((task: Task) => !task || typeof task.done !== 'boolean' || (task.completed_at !== null && typeof task.completed_at !== 'string') || (filters.completion !== 'all' && task.done !== (filters.completion === 'completed')) || (filters.investigations !== 'all' && ['resolved', 'closed', 'false_positive'].includes(task.case_status) !== (filters.investigations === 'inactive')) || !Number.isSafeInteger(task.task_id) || task.task_id < 1 || !Number.isSafeInteger(task.case_id) || task.case_id < 1 || typeof task.title !== 'string' || typeof task.case_title !== 'string' || typeof task.case_status !== 'string' || typeof task.case_severity !== 'string' || (task.due_date !== null && typeof task.due_date !== 'string') || (task.case_due_date !== null && typeof task.case_due_date !== 'string'))) throw new Error('Assigned task evidence did not match the requested page. Retry before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 25)); if (page > last) { setPage(last); return; }
      setSnapshot({ groups: value.by_investigation, groupCount: value.investigation_groups_total, groupLimit: value.investigation_group_limit, tasks: value.data, total: value.total, summary: summaryFrom(value.summary, value.total, filters.completion), loadedAt: new Date().toLocaleString() }); setMustRefresh(false);
    }).catch(err => { if (requestId.current === request) setError(getApiErrorMessage(err, 'Assigned task exploration unavailable.')); }).finally(() => { if (requestId.current === request) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [open, filters, page, retry]);
  const windowValid = due !== 'range' || (validTaskDate(dueFrom) && validTaskDate(dueThrough) && dueFrom <= dueThrough);
  const dirty = query !== filters.query || severity !== filters.severity || due !== filters.due || today !== filters.today || completion !== filters.completion || investigations !== filters.investigations || (due === 'range' && (dueFrom !== filters.dueFrom || dueThrough !== filters.dueThrough));
  return <section aria-label="Full assigned task explorer" className="oa-panel space-y-4 p-4 sm:p-6">
    <button type="button" className="text-left text-sm font-semibold text-primary-300" aria-expanded={open} onClick={() => setOpen(!open)}>Explore all assigned tasks beyond the editing snapshot</button>
    {notice && <p role="status" className="text-sm text-warning">{notice}</p>}
    {open && <>
      <p className="text-xs text-surface-400">Explore and individually edit tasks currently assigned to you on currently visible investigations. Defaults to open work on active investigations. Include completed tasks or inactive investigations to find records missing from the editing snapshot. This is not past assignment history, a work log or proof of external remediation. A recorded completion may not have a timestamp. Search and filters apply before server paging, not just to the first 200 tasks. Review a task change here or open its investigation for the full checklist. This does not change selection or due-date drafts in the editing snapshot below. Refresh this explorer after edits elsewhere.</p>
      <section aria-label="Saved assigned workload filters" className="space-y-2 rounded border border-surface-700 p-3">
        <h3 className="text-sm font-semibold text-surface-100">Your saved workload views</h3>
        <p className="text-xs text-surface-400">Save applied filters only, not draft edits, tasks, selection, pages or access. Views are private to your account. Calendar dates are fixed, not rolling: check the saved date before relying on due buckets. Applying a view replaces filter drafts and reloads current assigned records from page 1; it never edits a task or grants investigation access.</p>
        <SavedViewsMenu basePath="/cases/workload-views/" currentFilters={savedWorkloadFilters(filters)} onApply={value => {
          const next = readWorkloadView(value);
          if (!next) { setNotice('Saved workload view is invalid. Filters and current results were not changed.'); return; }
          setQuery(next.query); setSeverity(next.severity); setDue(next.due); setToday(next.today); setCompletion(next.completion); setInvestigations(next.investigations); setDueFrom(next.dueFrom); setDueThrough(next.dueThrough);
          setSnapshot(null); setFilters(next); setPage(1); setNotice('Applied saved workload filters. Check the fixed calendar date. Records reload with your current assignment and visibility.');
        }} />
      </section>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (!windowValid || !today) return; setSnapshot(null); setFilters({ query, severity, due, today, completion, investigations, dueFrom, dueThrough, investigationId: filters.investigationId }); setPage(1); }}>
        <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-surface-400 sm:basis-64 sm:flex-1">Search all assigned task titles, investigations or IDs<input aria-label="Search full assigned workload" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} className={control} /></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Investigation severity<select aria-label="Full workload severity" value={severity} onChange={event => setSeverity(event.target.value)} className={control}><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Task completion<select aria-label="Full workload completion" value={completion} onChange={event => setCompletion(event.target.value)} className={control}><option value="open">Open tasks</option><option value="completed">Completed tasks</option><option value="all">Open and completed tasks</option></select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Investigation scope<select aria-label="Full workload investigation scope" value={investigations} onChange={event => setInvestigations(event.target.value)} className={control}><option value="active">Active investigations</option><option value="inactive">Resolved, closed or false-positive</option><option value="all">All visible investigations</option></select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Task due date<select aria-label="Full workload due filter" value={due} onChange={event => setDue(event.target.value)} className={control}>{[['all', 'Any due date'], ['overdue', 'Due before date'], ['today', 'Due on date'], ['future', 'Due after date'], ['none', 'No due date'], ['range', 'Fixed inclusive date window']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Calendar date for due filters<input required type="date" aria-label="Full workload calendar date" value={today} onChange={event => setToday(event.target.value)} className={control} /></label>
        {due === 'range' && <><label className="flex flex-col gap-1 text-xs text-surface-400">Task due from<input type="date" aria-label="Full workload due from" value={dueFrom} onChange={event => setDueFrom(event.target.value)} className={control} /></label><label className="flex flex-col gap-1 text-xs text-surface-400">Task due through<input type="date" aria-label="Full workload due through" value={dueThrough} onChange={event => setDueThrough(event.target.value)} className={control} /></label></>}
        <button type="submit" className={control} disabled={!today || !windowValid}>Apply full workload filters</button>
      </form>
      {due === 'range' && <p role="status" className="text-xs text-warning">Fixed windows include both calendar-date boundaries, not a rolling local-day bucket. Choose valid dates in ascending order before applying. Matching counts include all server pages and the applied completion/investigation scope, not just open tasks.</p>}
      <p className="text-xs text-surface-400">Due filters compare the recorded task due date, including completed tasks. A past due date alone does not mean a completed task was late. Exploration alone changes nothing. Task edits require a separate review and confirmation.</p>
      {filters.investigationId !== null && <p className="text-xs text-primary-300">Applied investigation #{filters.investigationId} only. <button type="button" className={control} onClick={() => { setSnapshot(null); setFilters(current => ({ ...current, investigationId: null })); setPage(1); }}>Remove applied investigation scope</button> Other applied filters stay unchanged; draft edits are not applied.</p>}
      {dirty && <p role="status" className="text-xs text-warning">Filter edits are not applied. Results still use the last applied filters.</p>}
      {loading && <p role="status" className="text-sm text-surface-300">Loading assigned task page...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && snapshot && <>
        <p className="break-words text-xs text-surface-400">{snapshot.total} matching assigned {snapshot.total === 1 ? 'task record' : 'task records'} · Page {page} of {Math.max(1, Math.ceil(snapshot.total / 25))}. Loaded {snapshot.loadedAt}. Applied search: {filters.query || '(none)'}; severity: {filters.severity}; due: {filters.due}{filters.due === 'range' ? ` (${filters.dueFrom} through ${filters.dueThrough}, inclusive)` : ''}; completion: {filters.completion}; investigations: {filters.investigations}{filters.investigationId !== null ? `; exact investigation #${filters.investigationId}` : ''}; calendar date: {filters.today}. Current records can change between page reads. Order: investigation severity, investigation due date, task due date, then checklist position and task ID.</p>
        <section role="region" aria-label="Matching assigned workload summary" className="space-y-3 rounded border border-surface-700 p-3">
          <h3 className="text-sm font-semibold text-surface-100">Full matching assigned workload</h3>
          <p className="text-xs text-surface-400">Counts cover every task matching the applied filters before paging. They are current assigned records, not past assignment history. Completed work without a timestamp cannot establish when it was finished. No timeliness score is inferred.</p>
          {snapshot.summary ? <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{[
            ['Matching tasks', snapshot.summary.total], ['Investigations represented', snapshot.summary.investigations],
            ['Open tasks', snapshot.summary.open], ['Completed tasks', snapshot.summary.completed],
            ['Without task due date', snapshot.summary.without_due_date], ['Completed without timestamp', snapshot.summary.completed_without_timestamp],
          ].map(([label, count]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="mt-1 text-lg font-semibold text-surface-100">{count}</dd></div>)}</dl> : <p role="status" className="text-xs text-warning">Full matching summary unavailable. Page records are still shown; totals are not inferred from this page.</p>}
        </section>
        <AssignedWorkloadBreakdown groups={snapshot.groups} groupCount={snapshot.groupCount} limit={snapshot.groupLimit} total={snapshot.total} onExplore={id => { setSnapshot(null); setFilters(current => ({ ...current, investigationId: id })); setPage(1); }} />
        {!snapshot.tasks.length && <p className="text-sm text-surface-400">No assigned tasks match these applied filters.</p>}
        <button type="button" className={control} disabled={!snapshot.tasks.length || mustRefresh || editingBlocked || editing !== null} onClick={() => setExportSnapshot(workloadPageSnapshot(snapshot.tasks, filters, page, snapshot.total, snapshot.loadedAt, new Date().toISOString()))}>Review this workload page CSV ({snapshot.tasks.length} records only)</button>
        <ul aria-label="Full workload task results" className="space-y-2">{snapshot.tasks.map(task => <li key={task.task_id} className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><p className="break-words font-semibold text-surface-100">Task #{task.task_id}: {task.title}</p><Link className="inline-block max-w-full break-words text-primary-300" to={`/cases/${task.case_id}?task=${task.task_id}`}>{task.case_title} · Investigation #{task.case_id}</Link><p className="break-words font-medium">{task.done ? 'Completed checklist task' : 'Open checklist task'} · Recorded completion: {task.completed_at || 'Not recorded'}</p><button type="button" className={control} disabled={editingBlocked || mustRefresh} onClick={() => setEditing(task)}>Edit assigned task #{task.task_id}</button><p className="break-words">{task.case_severity} · {task.case_status.replaceAll('_', ' ')} · Task due: {task.due_date || 'Not set'} · Investigation due: {task.case_due_date || 'Not set'}</p></li>)}</ul>
      </>}
      <nav aria-label="Full assigned workload pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={loading || !snapshot || page === 1} onClick={() => setPage(page - 1)}>Previous workload page</button><button type="button" className={control} disabled={loading || !snapshot || page * 25 >= snapshot.total} onClick={() => setPage(page + 1)}>Next workload page</button><button type="button" className={control} disabled={loading} onClick={() => setRetry(retry + 1)}>Refresh full workload page</button></nav>
    </>}
    {exportSnapshot && <AssignedWorkloadPageExport snapshot={exportSnapshot} onClose={() => setExportSnapshot(null)} />}
    {editingBlocked && open && <p className="text-xs text-warning">Wait for snapshot saves and save or discard snapshot due-date drafts before opening a full-workload task review.</p>}
    {editing && <AssignedTaskEditor key={editing.task_id} task={editing} onClose={() => { setEditing(null); if (mustRefresh) setRetry(value => value + 1); }} onChanged={confirmed => { setMustRefresh(true); onEdited?.(); if (confirmed) { setEditing(null); setNotice(`Confirmed the reviewed change to task #${editing.task_id}. Workload totals are reloaded from the server. Refresh the editing snapshot below before using it again.`); setRetry(value => value + 1); } else { setNotice('A task write was attempted but not confirmed. Refresh the full workload and editing snapshot before another edit.'); } }} />}
  </section>;
}
