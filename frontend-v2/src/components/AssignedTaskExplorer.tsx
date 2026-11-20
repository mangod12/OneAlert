import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Task { task_id: number; case_id: number; title: string; case_title: string; case_severity: string; case_status: string; due_date: string | null; case_due_date: string | null; }
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function AssignedTaskExplorer() {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all'), [due, setDue] = useState('all'), [today, setToday] = useState(localDate);
  const [filters, setFilters] = useState({ query: '', severity: 'all', due: 'all', today: localDate() });
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{ tasks: Task[]; total: number; loadedAt: string } | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setSnapshot(null); setError('');
    if (!open) { setLoading(false); return; }
    setLoading(true);
    void apiClient.get('/cases/assigned-task-explorer', { params: { ...filters, page, size: 25 } }).then(response => {
      if (requestId.current !== request) return;
      const value = response.data;
      if (!Array.isArray(value.data) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page || value.size !== 25 || value.filter_date !== filters.today || value.data.some((task: Task) => !task || !Number.isSafeInteger(task.task_id) || task.task_id < 1 || !Number.isSafeInteger(task.case_id) || task.case_id < 1 || typeof task.title !== 'string' || typeof task.case_title !== 'string' || typeof task.case_status !== 'string' || typeof task.case_severity !== 'string' || (task.due_date !== null && typeof task.due_date !== 'string') || (task.case_due_date !== null && typeof task.case_due_date !== 'string'))) throw new Error('Assigned task evidence did not match the requested page. Retry before relying on it.');
      const last = Math.max(1, Math.ceil(value.total / 25)); if (page > last) { setPage(last); return; }
      setSnapshot({ tasks: value.data, total: value.total, loadedAt: new Date().toLocaleString() });
    }).catch(err => { if (requestId.current === request) setError(getApiErrorMessage(err, 'Assigned task exploration unavailable.')); }).finally(() => { if (requestId.current === request) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [open, filters, page, retry]);
  const dirty = query !== filters.query || severity !== filters.severity || due !== filters.due || today !== filters.today;
  return <section aria-label="Full assigned task explorer" className="oa-panel space-y-4 p-4 sm:p-6">
    <button type="button" className="text-left text-sm font-semibold text-primary-300" aria-expanded={open} onClick={() => setOpen(!open)}>Explore all assigned tasks beyond the editing snapshot</button>
    {open && <>
      <p className="text-xs text-surface-400">Read-only exploration of open tasks assigned to you on visible active investigations. Search and filters apply before server paging, not just to the first 200 tasks. Open an investigation to work on its full checklist. This does not change selection or due-date drafts in the editing snapshot below. Refresh this explorer after edits elsewhere.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setSnapshot(null); setFilters({ query, severity, due, today }); setPage(1); }}>
        <label className="flex min-w-0 basis-full flex-col gap-1 text-xs text-surface-400 sm:basis-64 sm:flex-1">Search all assigned task titles, investigations or IDs<input aria-label="Search full assigned workload" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} className={control} /></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Investigation severity<select aria-label="Full workload severity" value={severity} onChange={event => setSeverity(event.target.value)} className={control}><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Task due date<select aria-label="Full workload due filter" value={due} onChange={event => setDue(event.target.value)} className={control}>{[['all', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due on date'], ['future', 'Due after date'], ['none', 'No due date']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-surface-400">Calendar date for due filters<input required type="date" aria-label="Full workload calendar date" value={today} onChange={event => setToday(event.target.value)} className={control} /></label>
        <button type="submit" className={control} disabled={!today}>Apply full workload filters</button>
      </form>
      {dirty && <p role="status" className="text-xs text-warning">Filter edits are not applied. Results still use the last applied filters.</p>}
      {loading && <p role="status" className="text-sm text-surface-300">Loading assigned task page...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && snapshot && <>
        <p className="break-words text-xs text-surface-400">{snapshot.total} matching assigned {snapshot.total === 1 ? 'task record' : 'task records'} · Page {page} of {Math.max(1, Math.ceil(snapshot.total / 25))}. Loaded {snapshot.loadedAt}. Applied search: {filters.query || '(none)'}; severity: {filters.severity}; due: {filters.due}; calendar date: {filters.today}. Current records can change between page reads. Order: investigation severity, investigation due date, task due date, then checklist position and task ID.</p>
        {!snapshot.tasks.length && <p className="text-sm text-surface-400">No assigned tasks match these applied filters.</p>}
        <ul aria-label="Full workload task results" className="space-y-2">{snapshot.tasks.map(task => <li key={task.task_id} className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300"><p className="break-words font-semibold text-surface-100">Task #{task.task_id}: {task.title}</p><Link className="inline-block max-w-full break-words text-primary-300" to={`/cases/${task.case_id}?task=${task.task_id}`}>{task.case_title} · Investigation #{task.case_id}</Link><p className="break-words">{task.case_severity} · {task.case_status.replaceAll('_', ' ')} · Task due: {task.due_date || 'Not set'} · Investigation due: {task.case_due_date || 'Not set'}</p></li>)}</ul>
      </>}
      <nav aria-label="Full assigned workload pages" className="flex flex-wrap gap-2"><button type="button" className={control} disabled={loading || !snapshot || page === 1} onClick={() => setPage(page - 1)}>Previous workload page</button><button type="button" className={control} disabled={loading || !snapshot || page * 25 >= snapshot.total} onClick={() => setPage(page + 1)}>Next workload page</button><button type="button" className={control} disabled={loading} onClick={() => setRetry(retry + 1)}>Refresh full workload page</button></nav>
    </>}
  </section>;
}
