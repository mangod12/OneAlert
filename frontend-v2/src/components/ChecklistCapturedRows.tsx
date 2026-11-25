import { ChecklistCapturedComparison } from './ChecklistCapturedComparison';
import { validTaskDate } from '../utils/checklistTriage';
import { useState } from 'react';
import type { ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
export function ChecklistCapturedRows({ tasks }: { tasks: ChecklistExportSnapshot['tasks'] }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [searchField, setSearchField] = useState('all');
  const [order, setOrder] = useState('captured');
  const [compositionOpen, setCompositionOpen] = useState(false);
  type CategoryField = 'done' | 'assignee_id' | 'due_date';
  const [categories, setCategories] = useState<Partial<Record<CategoryField, boolean | number | string | null>>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const select = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  const needle = query.trim().toLowerCase();
  const validSearch = searchField !== 'id' || !needle || (/^[1-9][0-9]*$/.test(needle) && Number.isSafeInteger(Number(needle)));
  const matching = tasks.filter(task => (Object.entries(categories) as [CategoryField, boolean | number | string | null][]).every(([field, value]) => task[field] === value) && validSearch && (!needle || (searchField === 'id' ? task.id === Number(needle) : (searchField === 'title' ? [task.title] : searchField === 'due' ? [task.due_date ?? 'not set'] : searchField === 'assignee' ? [task.assignee_id === null ? 'unassigned' : String(task.assignee_id)] : searchField === 'completion' ? [task.done ? 'completed' : 'open'] : searchField === 'position' ? [String(task.position)] : [String(task.id), task.title, task.done ? 'completed' : 'open', task.due_date ?? 'not set', task.assignee_id === null ? 'unassigned' : String(task.assignee_id), String(task.position)]).some(value => value.toLowerCase().includes(needle)))));
  if (order !== 'captured') matching.sort((a, b) => {
    if (order === 'id') return a.id - b.id;
    if (order === 'position') return a.position - b.position;
    if (order === 'title') return a.title.localeCompare(b.title);
    const aValid = validTaskDate(a.due_date), bValid = validTaskDate(b.due_date);
    if (!aValid) return bValid ? 1 : 0;
    if (!bValid) return -1;
    return a.due_date!.localeCompare(b.due_date!);
  });
  const pages = Math.max(1, Math.ceil(matching.length / 10)), current = Math.min(page, pages - 1);
  return <section aria-label="Captured checklist task inspection" className="space-y-2 rounded border border-surface-700 p-2 text-xs">
    <button type="button" aria-expanded={compositionOpen} onClick={() => setCompositionOpen(value => !value)} className="min-h-9 rounded border border-surface-700 px-2">Explore captured checklist composition</button>
    {compositionOpen && <section aria-label="Captured checklist composition" className="space-y-3 rounded border border-surface-700 p-2">
      <p>Counts cover all {tasks.length} frozen captured tasks across inspection pages, independent of inspection search/category. These are recorded task counts, not fresh state, current people or remediation proof. Combine exact completion, recorded assignee and raw due date categories with AND plus inspection text. Choose an active category again to remove it; counts always cover the full frozen capture, not remaining matches. Comparison selection and CSV/JSON downloads stay unchanged.</p>
      {(['done', 'assignee_id', 'due_date'] as const).map(field => {
        const counts = new Map<boolean | number | string | null, number>(); for (const task of tasks) counts.set(task[field], (counts.get(task[field]) ?? 0) + 1);
        const label = field === 'done' ? 'Completion' : field === 'assignee_id' ? 'Recorded assignee' : 'Raw due date';
        return <div key={field}><h4 className="font-medium">{label}</h4><div className="mt-1 flex flex-wrap gap-2">{[...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => <button type="button" key={JSON.stringify(value)} aria-pressed={Object.hasOwn(categories, field) && categories[field] === value} onClick={() => { setCategories(current => { const next = { ...current }; if (Object.hasOwn(current, field) && current[field] === value) delete next[field]; else next[field] = value; return next; }); setPage(0); }} className="min-h-9 max-w-full rounded border border-surface-700 px-2 text-left [overflow-wrap:anywhere]">{label}: {field === 'done' ? value ? 'Completed' : 'Open' : field === 'assignee_id' ? value === null ? 'Unassigned' : `#${value}` : value === null ? '(Not set)' : value === '' ? '(Empty saved value)' : value} · {count} {count === 1 ? 'task' : 'tasks'}</button>)}</div></div>;
      })}
      <p>Assignee IDs are raw recorded IDs, not names or current access. Due dates are exact saved strings, not validated deadlines, overdue counts or the viewer's current local day. Missing and empty due dates stay distinct.</p>
    </section>}
    {Object.keys(categories).length > 0 && <div className="space-y-2 [overflow-wrap:anywhere]">
      <p>All selected inspection categories must match. Categories narrow inspection only, never reviewed exports.</p>
      {(Object.entries(categories) as [CategoryField, boolean | number | string | null][]).map(([field, value]) => <p key={field} role="status">Inspection category: {field} = {value === null ? '(Not set)' : value === '' ? '(Empty saved value)' : String(value)}. <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => { setCategories(current => { const next = { ...current }; delete next[field]; return next; }); setPage(0); }}>Remove captured checklist {field} category</button></p>)}
      <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => { setCategories({}); setPage(0); }}>Clear captured checklist category</button>
    </div>}
    <label className="block">Find within captured checklist tasks<input aria-label="Find within captured checklist tasks" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full min-w-0 rounded border border-surface-600 bg-surface-950 px-2" /></label>
    <label className="block">Search captured checklist field<select aria-label="Search captured checklist field" value={searchField} onChange={event => { setSearchField(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full rounded border border-surface-600 bg-surface-950 px-2"><option value="all">All captured task fields</option><option value="title">Saved title only</option><option value="due">Raw due date only</option><option value="assignee">Recorded assignee ID or unassigned</option><option value="completion">Recorded completion only</option><option value="position">Checklist position only</option><option value="id">Exact captured task ID</option></select></label>
    <p>Literal case-insensitive substring in the chosen captured field. Exact task ID requires one positive safe whole-number ID, not a partial ID or title. Empty text keeps all tasks within the inspection category. Unassigned and not set are explicit missing-assignee/due markers, not inferred names or valid dates. Search changes inspection only, not CSV/JSON tasks, captured criteria or live filters.</p>
    {!validSearch && <p role="status" className="text-warning">Enter one positive whole captured task ID. Invalid IDs match no inspection tasks; reviewed exports remain unchanged.</p>}

    <label className="block">Captured checklist inspection order<select aria-label="Captured checklist inspection order" value={order} onChange={event => { setOrder(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full rounded border border-surface-600 bg-surface-950 px-2"><option value="captured">Original captured order</option><option value="due">Valid saved due date, earliest first</option><option value="title">Saved title, ascending</option><option value="position">Checklist position, ascending</option><option value="id">Task ID, ascending</option></select></label>
    <p>Order changes inspection only, never captured CSV/JSON order, criteria, composition or comparison selection. Equal sort values keep captured order. Missing or invalid due dates stay last in captured order, without claiming an overdue state or a current deadline.</p>
    <p role="status">Captured tasks {matching.length ? current * 10 + 1 : 0}-{Math.min((current + 1) * 10, matching.length)} of {matching.length} inspection matches; {tasks.length} tasks remain in the reviewed export. Inspection page {current + 1} of {pages}.</p>
    {query && <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => { setQuery(''); setPage(0); }}>Clear captured checklist search</button>}
    {pages > 1 && <div className="flex flex-wrap gap-2"><button type="button" disabled={current === 0} className="min-h-9 rounded border border-surface-700 px-2 disabled:opacity-40" onClick={() => setPage(current - 1)}>Previous captured checklist tasks</button><button type="button" disabled={current === pages - 1} className="min-h-9 rounded border border-surface-700 px-2 disabled:opacity-40" onClick={() => setPage(current + 1)}>Next captured checklist tasks</button></div>}
    <p>Select up to two captured tasks to compare saved fields. Selection stays across inspection search and pages, not across discarded reviews.</p>
    <p role="status">Task comparison selection: {selected.length ? selected.map((id, index) => `${index === 0 ? 'baseline' : 'comparison'} #${id}`).join('; ') : 'none'}.</p>
    {selected.length > 0 && <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => setSelected([])}>Clear checklist comparison selection</button>}
    {selected.length === 2 && <ChecklistCapturedComparison tasks={tasks} baselineId={selected[0]} comparisonId={selected[1]} onClear={() => setSelected([])} />}
    <ul aria-label="Checklist export task review" className="max-h-72 space-y-2 overflow-y-auto text-sm">{matching.slice(current * 10, (current + 1) * 10).map(task => <li key={task.id} className="rounded border border-surface-700 p-2 [overflow-wrap:anywhere]">#{task.id}: {task.title}<button type="button" aria-label={`Compare captured checklist task ${task.id}`} aria-pressed={selected.includes(task.id)} disabled={selected.length === 2 && !selected.includes(task.id)} onClick={() => select(task.id)} className="my-1 block min-h-9 rounded border border-surface-700 px-2 text-xs disabled:opacity-40">{selected.includes(task.id) ? 'Remove task from comparison' : 'Select task for comparison'}</button><p className="text-xs">{task.done ? 'Completed' : 'Open'} · Due {task.due_date || 'not set'} · {task.assignee_id === null ? 'Unassigned' : `Assignee #${task.assignee_id}`} · Position {task.position}</p></li>)}</ul>
    {!matching.length && <p>No captured tasks match this inspection text. Category filters, if selected, also apply. The reviewed export is unchanged. Clear the search to inspect all captured tasks.</p>}
  </section>;
}
