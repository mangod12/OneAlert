import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { AssignedTaskExplorer } from '../components/AssignedTaskExplorer';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TaskSnapshotReview, type SnapshotTaskReview } from '../components/TaskSnapshotReview';
import { alertSeverityTones } from '../components/ui/tones';
import { checkedSnapshotTaskResult, checkedTaskAccount, checkedTaskSnapshot, reviewedTaskPayload, sameSnapshotTask, type SnapshotTaskChange } from '../utils/taskSnapshotReview';

export interface AssignedTask {
  task_id: number;
  case_id: number;
  case_title: string;
  case_severity: string;
  case_status: string;
  case_due_date: string | null;
  title: string;
  due_date: string | null;
  created_at: string;
}

export function MyTasks() {
  const [snapshotStale, setSnapshotStale] = useState(false);
  const pending = useRef(new Set<number>());
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});
  const [dueDrafts, setDueDrafts] = useState<Record<number, string>>({});
  const [actionNotice, setActionNotice] = useState('');
  const [noticeFailed, setNoticeFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState('');
  const [bulkMode, setBulkMode] = useState('set');
  const [taskReview, setTaskReview] = useState<SnapshotTaskReview | null>(null);
  const reviewPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loadedAt, setLoadedAt] = useState('');
  const [query, setQuery] = useState('');
  const [due, setDue] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [order, setOrder] = useState('recorded');
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void apiClient.get<AssignedTask[]>('/cases/my-tasks').then(response => {
      if (active) { setSnapshotStale(false); setTasks(checkedTaskSnapshot(response.data)); setLimitReached(response.data.length >= 200); setTaskReview(null); setDueDrafts({}); setActionErrors({}); setSelectedIds(new Set()); setLoadedAt(new Date().toLocaleString()); }
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Assigned tasks could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const selectedTasks = tasks.filter(task => selectedIds.has(task.task_id));
  const selectedHaveDrafts = selectedTasks.some(task => (dueDrafts[task.task_id] ?? task.due_date ?? '') !== (task.due_date ?? ''));
  const stageTasks = async (chosen: AssignedTask[], change: SnapshotTaskChange) => {
    if (snapshotStale || bulkBusy || reviewPending.current || pending.current.size || !chosen.length) return;
    reviewPending.current = true; setBulkBusy(true); setActionNotice('');
    try {
      chosen.forEach(task => reviewedTaskPayload(task, change));
      const account = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (mounted.current) setTaskReview({ tasks: chosen.map(task => ({ ...task })), change: { ...change }, hidden: chosen.filter(task => !visible.some(row => row.task_id === task.task_id)).length, account });
    } catch { if (mounted.current) { setNoticeFailed(true); setActionNotice('The exact task review or current account could not be verified. No task update was sent. Refresh tasks before reviewing again.'); setSnapshotStale(true); } }
    finally { reviewPending.current = false; if (mounted.current) setBulkBusy(false); }
  };
  const confirmTasks = async () => {
    if (!taskReview || snapshotStale || bulkBusy || reviewPending.current || pending.current.size) return;
    reviewPending.current = true; setBulkBusy(true); setActionNotice(''); setNoticeFailed(false);
    const review = taskReview, saved = new Map<number, { done: boolean; due_date: string | null }>();
    let sent = false, failure = '';
    review.tasks.forEach(task => pending.current.add(task.task_id)); setBusyIds(new Set(pending.current));
    try {
      const [identity, source] = await Promise.all([apiClient.get('/auth/me'), apiClient.get('/cases/my-tasks')]);
      const account = checkedTaskAccount(identity.data), current = checkedTaskSnapshot(source.data);
      if (!mounted.current) return;
      if (JSON.stringify(account) !== JSON.stringify(review.account) || review.tasks.some(task => !current.some(row => sameSnapshotTask(row, task)))) throw Error('The account or a reviewed task changed or left the current snapshot.');
      for (const task of review.tasks) {
        if (!mounted.current) return;
        sent = true;
        const response = await apiClient.patch(`/cases/assigned-task-explorer/${task.task_id}`, reviewedTaskPayload(task, review.change));
        if (!mounted.current) return;
        const value = checkedSnapshotTaskResult(task, review.change, response.status, response.data);
        if (response.data.assignee_id !== account.id) throw Error('Returned assignment differs from the reviewed account.');
        saved.set(task.task_id, value);
      }
    } catch { failure = sent ? 'A task change outcome is unknown. It may already have applied. Processing stopped; later tasks were not sent. Refresh tasks before any retry. No automatic retry was sent.' : 'Current account or reviewed task state could not be reverified. No task mutation was sent. Refresh tasks; your drafts and selection are kept until then.'; }
    finally {
      reviewPending.current = false; review.tasks.forEach(task => pending.current.delete(task.task_id));
      if (mounted.current) {
        setTasks(current => current.filter(task => !saved.get(task.task_id)?.done).map(task => saved.has(task.task_id) ? { ...task, due_date: saved.get(task.task_id)!.due_date } : task));
        setSelectedIds(current => new Set([...current].filter(id => !saved.has(id))));
        setDueDrafts(current => { const next = { ...current }; saved.forEach((_, id) => { delete next[id]; }); return next; });
        setTaskReview(null); setSnapshotStale(true); setBusyIds(new Set(pending.current)); setBulkBusy(false); setNoticeFailed(!!failure);
        setActionNotice(`Verified ${saved.size} of ${review.tasks.length} reviewed task changes. ${failure || 'Each task was a separate transaction. Investigation status, investigation due dates and assignments were not changed. Refresh both task views before another edit.'}`);
      }
    }
  };
  const needle = query.trim().toLowerCase();
  const visible = tasks.filter(task => (!needle || [task.title, task.case_title, String(task.case_id), String(task.task_id)].some(value => value.toLowerCase().includes(needle)))
    && (severity === 'all' || task.case_severity === severity)
    && (due === 'all' || (due === 'overdue' ? !!task.due_date && task.due_date < today : due === 'today' ? task.due_date === today : due === 'future' ? !!task.due_date && task.due_date > today : !task.due_date)));
  if (order !== 'recorded') visible.sort((a, b) => {
    if (order === 'title') return a.title.localeCompare(b.title) || a.task_id - b.task_id;
    if (order === 'case') return a.case_title.localeCompare(b.case_title) || a.case_id - b.case_id || a.task_id - b.task_id;
    return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || a.task_id - b.task_id;
  });
  const filtered = !!query || due !== 'all' || severity !== 'all' || order !== 'recorded';
  return <div className="min-w-0 space-y-5">
    <PageHeader eyebrow="Command" title="My tasks" description="Review open checklist tasks assigned to you across active investigations. Complete assigned work and edit task due dates here, or open the investigation for its full checklist."
      actions={<button type="button" disabled={loading || bulkBusy || !!taskReview || busyIds.size > 0} onClick={() => setRefresh(value => value + 1)} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-200 disabled:opacity-40">Refresh tasks</button>} />
    <AssignedTaskExplorer key={refresh} editingBlocked={!!taskReview || snapshotStale || loading || !!busyIds.size || bulkBusy || Object.keys(dueDrafts).some(id => dueDrafts[Number(id)] !== (tasks.find(row => row.task_id === Number(id))?.due_date ?? ''))} onEdited={() => { setSnapshotStale(true); setTaskReview(null); }} />
    {snapshotStale && <p role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">A reviewed task operation or an unverifiable review may have changed this editing snapshot. Snapshot controls are paused. Review any kept drafts, then use Refresh tasks to discard drafts and reload current work.</p>}
    <p className="text-sm text-surface-400">The editing snapshot below returns up to 200 assigned tasks, not a complete workload count. Use the explorer above to page through the full matching workload. Completed tasks and resolved, closed or false-positive investigations are excluded. Filters and order apply only to returned records.</p>
    {actionNotice && <p role={noticeFailed ? 'alert' : 'status'} className={`rounded border p-3 text-sm ${noticeFailed ? 'border-warning/40 text-warning' : 'border-success/40 text-success'}`}>{actionNotice}</p>}
    <fieldset disabled={snapshotStale || bulkBusy || !!taskReview} className="min-w-0 space-y-5">{loading ? <LoadingSurface label="Loading assigned tasks" /> : error ? <ErrorState title="Assigned tasks unavailable" description={error} action={<RetryButton onClick={() => setRefresh(value => value + 1)} />} /> : <>
      <div className="rounded-lg border border-surface-700 bg-surface-900 p-4">
        <p className="text-xs text-surface-400">Snapshot loaded {loadedAt}; successful task edits are reflected below. Task due dates use UTC today: {today}. Investigation due dates are shown separately.</p>
        {limitReached && <p role="status" className="mt-2 text-sm text-warning">The 200-task return limit was reached. Other assigned tasks may be missing, including after completing a task here. Refresh to load more, or open investigations to review work outside this returned set.</p>}
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[
          ['Returned tasks', tasks.length], ['Investigations represented', new Set(tasks.map(task => task.case_id)).size],
          ['Overdue tasks', tasks.filter(task => task.due_date && task.due_date < today).length], ['Without task due date', tasks.filter(task => !task.due_date).length],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-surface-400">{label}</dt><dd className="mt-1 text-xl font-semibold text-surface-100">{value}</dd></div>)}</dl>
      </div>
      {tasks.length === 0 ? <EmptyState title="No assigned tasks returned" description="No open checklist tasks were returned for your account on active investigations." /> : <>
        <section aria-label="Assigned task filters" className="space-y-3 rounded-lg border border-surface-700 p-4">
          <label htmlFor="assigned-task-search" className="block text-sm text-surface-200">Find assigned work</label>
          <input id="assigned-task-search" type="search" value={query} disabled={bulkBusy} onChange={event => setQuery(event.target.value)} placeholder="Task, investigation or record ID" className="min-h-10 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100" />
          <div className="flex flex-wrap gap-2">
            <select aria-label="Task due scope" value={due} disabled={bulkBusy} onChange={event => setDue(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="all">All task due dates</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="future">Due later</option><option value="none">No task due date</option></select>
            <select aria-label="Investigation severity" value={severity} disabled={bulkBusy} onChange={event => setSeverity(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label="Assigned task order" value={order} disabled={bulkBusy} onChange={event => setOrder(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="recorded">Returned order</option><option value="due">Task due date first</option><option value="case">Investigation A to Z</option><option value="title">Task title A to Z</option></select>
            {filtered && <button type="button" disabled={bulkBusy} onClick={() => { setQuery(''); setDue('all'); setSeverity('all'); setOrder('recorded'); }} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-200">Clear task filters</button>}
          </div>
          <p role="status" className="text-xs text-surface-300">{visible.length} of {tasks.length} returned tasks match. Summary counts above describe the returned set, not just these matches.</p>
        </section>
        <section aria-label="Selected task due dates" className="space-y-3 rounded-lg border border-surface-700 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={bulkBusy || !visible.length} onClick={() => setSelectedIds(current => new Set([...current, ...visible.map(task => task.task_id)]))} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Select matching tasks</button>
            <button type="button" disabled={bulkBusy || !selectedTasks.length} onClick={() => setSelectedIds(new Set())} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Clear task selection</button>
          </div>
          <p className="text-xs text-surface-300">{selectedTasks.length} selected in the loaded set; {selectedTasks.filter(task => !visible.some(row => row.task_id === task.task_id)).length} hidden by filters. Selection does not include tasks outside this snapshot.</p>
          {!!selectedTasks.length && <>
            <details className="text-xs text-surface-300"><summary className="cursor-pointer">Review selected tasks</summary><ul aria-label="Selected task preview" tabIndex={0} className="mt-2 max-h-48 space-y-2 overflow-y-auto">{selectedTasks.map(task => <li key={task.task_id} className="break-words">#{task.task_id}: {task.title} · Investigation #{task.case_id} · Due {task.due_date || 'not set'}</li>)}</ul></details>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Selected task date action" disabled={bulkBusy} value={bulkMode} onChange={event => setBulkMode(event.target.value)} className="rounded border border-surface-600 bg-surface-950 px-2 py-2 text-sm text-surface-200"><option value="set">Set task due dates</option><option value="clear">Clear task due dates</option></select>
              {bulkMode === 'set' && <input type="date" aria-label="Due date for selected tasks" disabled={bulkBusy} value={bulkDate} onChange={event => setBulkDate(event.target.value)} className="min-w-0 rounded border border-surface-600 bg-surface-950 px-2 py-2 text-sm text-surface-100" />}
              <button type="button" disabled={bulkBusy || !!busyIds.size || selectedHaveDrafts || (bulkMode === 'set' && !bulkDate)} onClick={() => void stageTasks(selectedTasks, { due_date: bulkMode === 'clear' ? null : bulkDate })} className="rounded bg-primary-500 px-3 py-2 text-sm font-semibold text-surface-950 disabled:opacity-40">Review date change</button>
            </div>
            <button type="button" disabled={bulkBusy || !!busyIds.size || selectedHaveDrafts} onClick={() => void stageTasks(selectedTasks, { done: true })} className="rounded border border-success/50 px-3 py-2 text-sm text-success disabled:opacity-40">Review selected completion</button>
            {selectedHaveDrafts && <p className="text-xs text-warning">Save or discard the selected tasks' due-date drafts before changing selected tasks in bulk.</p>}
          </>}
        </section>
        {visible.length ? <ul aria-label="Assigned tasks" className="space-y-3">{visible.map(task => <li key={task.task_id} className="min-w-0 rounded-lg border border-surface-700 bg-surface-900 p-4">
          <label className="mb-3 flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" aria-label={`Select task #${task.task_id}: ${task.title}`} checked={selectedIds.has(task.task_id)} disabled={bulkBusy || busyIds.has(task.task_id)} onChange={event => setSelectedIds(current => { const next = new Set(current); if (event.target.checked) next.add(task.task_id); else next.delete(task.task_id); return next; })} />Select task #{task.task_id}</label>
          <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={alertSeverityTones[task.case_severity] ?? 'neutral'}>{task.case_severity}</StatusBadge><span className="text-xs text-surface-400">Investigation {task.case_status.replaceAll('_', ' ')}</span>{task.due_date && task.due_date < today && <span className="text-xs font-semibold text-danger">Task overdue</span>}</div>
          <h2 className="mt-3 break-words text-base font-semibold text-surface-100">{task.title}</h2>
          <Link to={`/cases/${task.case_id}?task=${task.task_id}`} className="mt-2 inline-block max-w-full break-words text-sm text-primary-300 underline-offset-4 hover:underline">{task.case_title} · Investigation #{task.case_id}</Link>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-surface-400"><span>Task #{task.task_id} due: {task.due_date || 'Not set'}</span><span>Investigation due: {task.case_due_date || 'Not set'}</span></div>
          <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void stageTasks([task], { due_date: (dueDrafts[task.task_id] ?? task.due_date) || null }); }}>
            <label className="text-xs text-surface-300">Task due date for #{task.task_id}
              <input aria-label={`Task due date for #${task.task_id}`} type="date" value={dueDrafts[task.task_id] ?? task.due_date ?? ''}
                disabled={busyIds.has(task.task_id)} onChange={event => setDueDrafts(current => ({ ...current, [task.task_id]: event.target.value }))}
                className="mt-1 block min-h-9 max-w-full rounded border border-surface-600 bg-surface-950 px-2 text-sm text-surface-100 disabled:opacity-40" />
            </label>
            <button type="submit" disabled={busyIds.has(task.task_id) || (dueDrafts[task.task_id] ?? task.due_date ?? '') === (task.due_date ?? '')}
              aria-label={`Save due date for task #${task.task_id}`} className="min-h-9 rounded border border-surface-600 px-3 text-xs text-surface-200 disabled:opacity-40">Save due date</button>
            {dueDrafts[task.task_id] !== undefined && <button type="button" disabled={busyIds.has(task.task_id)} onClick={() => setDueDrafts(current => { const next = { ...current }; delete next[task.task_id]; return next; })}
              aria-label={`Discard due date draft for task #${task.task_id}`} className="min-h-9 rounded border border-surface-600 px-3 text-xs text-surface-200 disabled:opacity-40">Discard draft</button>}
            <button type="button" disabled={busyIds.has(task.task_id) || (dueDrafts[task.task_id] ?? task.due_date ?? '') !== (task.due_date ?? '')} onClick={() => void stageTasks([task], { done: true })}
              aria-label={`Complete task #${task.task_id}: ${task.title}`} className="min-h-9 rounded bg-primary-500 px-3 text-xs font-semibold text-surface-950 disabled:opacity-40">{busyIds.has(task.task_id) ? 'Saving...' : 'Mark complete'}</button>
          </form>
          {(dueDrafts[task.task_id] ?? task.due_date ?? '') !== (task.due_date ?? '') && <p className="mt-2 text-xs text-surface-400">Save or discard the due-date draft before completing this task.</p>}
          {actionErrors[task.task_id] && <p role="alert" className="mt-2 text-sm text-danger">{actionErrors[task.task_id]}</p>}
        </li>)}</ul> : <EmptyState title="No returned tasks match" description="Clear filters to see the returned task set. This does not mean you have no assigned work." />}
      </>}
    </>}
    </fieldset>
    {taskReview && <TaskSnapshotReview review={taskReview} busy={bulkBusy} onCancel={() => { if (!bulkBusy) setTaskReview(null); }} onConfirm={() => void confirmTasks()} />}
  </div>;
}
