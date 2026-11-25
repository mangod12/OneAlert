import { TimelineCapturedComparison } from './TimelineCapturedComparison';
import { timelineRecordedTime, timelineUtcDay } from '../utils/timelineReview';
import { useState } from 'react';
import type { TimelineExportSnapshot } from '../utils/timelineReviewExport';

export function TimelineCapturedRows({ rows }: { rows: TimelineExportSnapshot['rows'] }) {
  const [page, setPage] = useState(0), [query, setQuery] = useState('');
  const [facet, setFacet] = useState<{ field: 'entry_type' | 'source' | 'author_email' | 'day'; value: string | null } | null>(null);
  const [order, setOrder] = useState('captured');
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const select = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  const needle = query.trim().toLowerCase();
  const matching = rows.filter(row => (!facet || (facet.field === 'day' ? timelineUtcDay(row.timestamp) : row[facet.field]) === facet.value) && (!needle || [String(row.id), row.timestamp, row.entry_type, row.source, row.author_email, row.content].some(value => value?.toLowerCase().includes(needle))));
  if (order !== 'captured') matching.sort((a, b) => {
    if (order === 'id') return a.id - b.id;
    const aTime = timelineRecordedTime(a.timestamp), bTime = timelineRecordedTime(b.timestamp);
    if (aTime === null) return bTime === null ? 0 : 1;
    if (bTime === null) return -1;
    return order === 'newest' ? bTime - aTime : aTime - bTime;
  });
  const pages = Math.max(1, Math.ceil(matching.length / 10)), current = Math.min(page, pages - 1);
  return <details className="rounded-md border border-surface-700 p-2">
    <summary className="min-h-9 cursor-pointer py-2">Inspect captured matching rows ({rows.length})</summary>
    <p className="mb-2">These are the frozen raw values in this captured review, not refreshed records or unsaved edits. CSV escaping adds protection for spreadsheet formulas; this view shows the saved text without executing it. No links in saved text are opened automatically.</p>
    <button type="button" aria-expanded={compositionOpen} onClick={() => setCompositionOpen(value => !value)} className="my-2 min-h-9 rounded-md border border-surface-600 px-2">Explore captured timeline composition</button>
    {compositionOpen && <section aria-label="Captured timeline composition" className="my-2 space-y-3 rounded-md border border-surface-700 p-2">
      <p>Composition of all {rows.length} frozen captured entries across inspection pages, independent of inspection text and category filters. Counts are entries, not unique evidence, current people or fresh server state. Choose a count to inspect that exact category while retaining inspection text. Downloads and comparison selection stay unchanged.</p>
      {(['entry_type', 'source', 'author_email', 'day'] as const).map(field => {
        const counts = new Map<string | null, number>();
        for (const row of rows) { const value = field === 'day' ? timelineUtcDay(row.timestamp) : row[field]; counts.set(value, (counts.get(value) ?? 0) + 1); }
        const label = field === 'entry_type' ? 'Type' : field === 'source' ? 'Source' : field === 'author_email' ? 'Recorded author' : 'Recorded UTC day';
        return <div key={field}><h4 className="font-medium">{label}</h4><div className="mt-1 flex flex-wrap gap-2">{[...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => <button type="button" key={JSON.stringify(value)} aria-pressed={facet?.field === field && facet.value === value} onClick={() => { setFacet({ field, value }); setPage(0); }} className="min-h-9 max-w-full rounded-md border border-surface-600 px-2 text-left [overflow-wrap:anywhere]">{label}: {value === null ? field === 'day' ? '(No usable UTC day)' : '(Not recorded)' : value === '' ? '(Empty saved value)' : value} · {count} {count === 1 ? 'entry' : 'entries'}</button>)}</div></div>;
      })}
      <p>UTC day uses the same recorded timestamp rules as live date filters, not the viewer's local date or an event-order claim. Raw timestamps remain unchanged in inspection and downloads.</p>
    </section>}
    {facet && <p role="status" className="my-2 [overflow-wrap:anywhere]">Inspection category: {facet.field} = {facet.value === null ? '(Not recorded or no usable UTC day)' : facet.value === '' ? '(Empty saved value)' : facet.value}. <button type="button" onClick={() => { setFacet(null); setPage(0); }} className="min-h-9 rounded-md border border-surface-600 px-2">Clear captured category</button></p>}
    <label className="mt-2 block">Find within captured rows<input type="text" aria-label="Find within captured rows" value={query} onChange={event => { setPage(0); setQuery(event.target.value); }} className="mt-1 min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-2" /></label>
    <p className="my-2">Literal case-insensitive text matching across captured ID, raw timestamp, type, source, author and saved text. This narrows only this inspection, never the captured CSV rows, capture criteria or live timeline filters.</p>
    <label className="my-2 block">Captured row inspection order<select aria-label="Captured row inspection order" value={order} onChange={event => { setOrder(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full rounded-md border border-surface-600 bg-surface-950 px-2"><option value="captured">Original captured order</option><option value="oldest">Recorded timestamp, oldest first</option><option value="newest">Recorded timestamp, newest first</option><option value="id">Entry ID, ascending</option></select></label>
    <p>Order affects inspection only, never captured CSV/JSON row order, capture criteria, composition counts or comparison selections. Recorded timestamp order uses UTC; equivalent instants keep captured order. Unusable timestamps stay last in captured order. This is recorded time, not proof of event sequence.</p>
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
    {!matching.length && <p className="mt-2">No captured rows match this inspection text. Category filters, if selected, also apply. The captured CSV is unchanged. Clear this search to inspect all captured rows.</p>}
  </details>;
}
