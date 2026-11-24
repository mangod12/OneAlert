import { TimelineCapturedComparison } from './TimelineCapturedComparison';
import { useState } from 'react';
import type { TimelineExportSnapshot } from '../utils/timelineReviewExport';

export function TimelineCapturedRows({ rows }: { rows: TimelineExportSnapshot['rows'] }) {
  const [page, setPage] = useState(0), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const select = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  const needle = query.trim().toLowerCase();
  const matching = rows.filter(row => !needle || [String(row.id), row.timestamp, row.entry_type, row.source, row.author_email, row.content].some(value => value?.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(matching.length / 10)), current = Math.min(page, pages - 1);
  return <details className="rounded-md border border-surface-700 p-2">
    <summary className="min-h-9 cursor-pointer py-2">Inspect captured matching rows ({rows.length})</summary>
    <p className="mb-2">These are the frozen raw values in this captured review, not refreshed records or unsaved edits. CSV escaping adds protection for spreadsheet formulas; this view shows the saved text without executing it. No links in saved text are opened automatically.</p>
    <label className="mt-2 block">Find within captured rows<input type="text" aria-label="Find within captured rows" value={query} onChange={event => { setPage(0); setQuery(event.target.value); }} className="mt-1 min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-2" /></label>
    <p className="my-2">Literal case-insensitive text matching across captured ID, raw timestamp, type, source, author and saved text. This narrows only this inspection, never the captured CSV rows, capture criteria or live timeline filters.</p>
    <p role="status">Captured rows {matching.length ? current * 10 + 1 : 0}-{Math.min((current + 1) * 10, matching.length)} of {matching.length}. {matching.length} inspection matches of {rows.length} captured rows. Page {current + 1} of {pages}.</p>
    {pages > 1 && <div className="my-2 flex flex-wrap gap-2">
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Previous captured rows</button>
      <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Next captured rows</button>
    </div>}
    <div className="my-2 space-y-2"><p>Select up to two captured entries to compare raw exported fields. Selection stays across inspection pages and search changes, not across discarded reviews.</p><p role="status">Comparison selection: {selected.length ? selected.map((id, index) => `${index === 0 ? 'baseline' : 'comparison'} #${id}`).join('; ') : 'none'}.</p>{selected.length > 0 && <button type="button" className="min-h-9 rounded-md border border-surface-600 px-2" onClick={() => setSelected([])}>Clear comparison selection</button>}</div>
    {selected.length === 2 && <TimelineCapturedComparison rows={rows} baselineId={selected[0]} comparisonId={selected[1]} onClear={() => setSelected([])} />}
    <ol className="mt-2 space-y-2" aria-label="Captured timeline rows" start={current * 10 + 1}>
      {matching.slice(current * 10, (current + 1) * 10).map((row, index) => <li key={`${index}:${row.id}`} className="min-w-0 rounded-md border border-surface-700 p-2 [overflow-wrap:anywhere]">
        <p className="font-medium text-surface-100">Captured entry #{row.id}</p>
        <button type="button" aria-label={`Compare captured entry ${row.id}`} aria-pressed={selected.includes(row.id)} disabled={selected.length === 2 && !selected.includes(row.id)} onClick={() => select(row.id)} className="my-1 min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">{selected.includes(row.id) ? 'Remove from comparison' : 'Select for comparison'}</button>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          <dt>Raw timestamp</dt><dd className="whitespace-pre-wrap">{row.timestamp || 'Not recorded'}</dd>
          <dt>Type</dt><dd className="whitespace-pre-wrap">{row.entry_type || 'Not recorded'}</dd>
          <dt>Source</dt><dd className="whitespace-pre-wrap">{row.source || 'Not recorded'}</dd>
          <dt>Recorded author</dt><dd className="whitespace-pre-wrap">{row.author_email || 'Not recorded'}</dd>
        </dl>
        <p className="mt-2 whitespace-pre-wrap">{row.content || '(Empty saved text)'}</p>
      </li>)}
    </ol>
    {!matching.length && <p className="mt-2">No captured rows match this inspection text. The captured CSV is unchanged. Clear this search to inspect all captured rows.</p>}
  </details>;
}
