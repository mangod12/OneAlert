import { ChecklistCapturedComparison } from './ChecklistCapturedComparison';
import { useState } from 'react';
import type { ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
export function ChecklistCapturedRows({ tasks }: { tasks: ChecklistExportSnapshot['tasks'] }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const select = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  const needle = query.trim().toLowerCase();
  const matching = tasks.filter(task => !needle || [String(task.id), task.title, task.done ? 'completed' : 'open', task.due_date ?? 'not set', task.assignee_id === null ? 'unassigned' : String(task.assignee_id), String(task.position)].some(value => value.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(matching.length / 10)), current = Math.min(page, pages - 1);
  return <section aria-label="Captured checklist task inspection" className="space-y-2 rounded border border-surface-700 p-2 text-xs">
    <label className="block">Find within captured checklist tasks<input aria-label="Find within captured checklist tasks" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full min-w-0 rounded border border-surface-600 bg-surface-950 px-2" /></label>
    <p>Literal case-insensitive matching across captured task ID, title, open/completed state, due date, assignee ID or unassigned, and checklist position. This narrows inspection only, not the reviewed CSV/JSON tasks or captured filter criteria. No saved task or live filter changes.</p>
    <p role="status">Captured tasks {matching.length ? current * 10 + 1 : 0}-{Math.min((current + 1) * 10, matching.length)} of {matching.length} inspection matches; {tasks.length} tasks remain in the reviewed export. Inspection page {current + 1} of {pages}.</p>
    {query && <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => { setQuery(''); setPage(0); }}>Clear captured checklist search</button>}
    {pages > 1 && <div className="flex flex-wrap gap-2"><button type="button" disabled={current === 0} className="min-h-9 rounded border border-surface-700 px-2 disabled:opacity-40" onClick={() => setPage(current - 1)}>Previous captured checklist tasks</button><button type="button" disabled={current === pages - 1} className="min-h-9 rounded border border-surface-700 px-2 disabled:opacity-40" onClick={() => setPage(current + 1)}>Next captured checklist tasks</button></div>}
    <p>Select up to two captured tasks to compare saved fields. Selection stays across inspection search and pages, not across discarded reviews.</p>
    <p role="status">Task comparison selection: {selected.length ? selected.map((id, index) => `${index === 0 ? 'baseline' : 'comparison'} #${id}`).join('; ') : 'none'}.</p>
    {selected.length > 0 && <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={() => setSelected([])}>Clear checklist comparison selection</button>}
    {selected.length === 2 && <ChecklistCapturedComparison tasks={tasks} baselineId={selected[0]} comparisonId={selected[1]} onClear={() => setSelected([])} />}
    <ul aria-label="Checklist export task review" className="max-h-72 space-y-2 overflow-y-auto text-sm">{matching.slice(current * 10, (current + 1) * 10).map(task => <li key={task.id} className="rounded border border-surface-700 p-2 [overflow-wrap:anywhere]">#{task.id}: {task.title}<button type="button" aria-label={`Compare captured checklist task ${task.id}`} aria-pressed={selected.includes(task.id)} disabled={selected.length === 2 && !selected.includes(task.id)} onClick={() => select(task.id)} className="my-1 block min-h-9 rounded border border-surface-700 px-2 text-xs disabled:opacity-40">{selected.includes(task.id) ? 'Remove task from comparison' : 'Select task for comparison'}</button><p className="text-xs">{task.done ? 'Completed' : 'Open'} · Due {task.due_date || 'not set'} · {task.assignee_id === null ? 'Unassigned' : `Assignee #${task.assignee_id}`} · Position {task.position}</p></li>)}</ul>
    {!matching.length && <p>No captured tasks match this inspection text. The reviewed export is unchanged. Clear the search to inspect all captured tasks.</p>}
  </section>;
}
