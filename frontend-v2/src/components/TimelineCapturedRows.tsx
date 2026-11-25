import { TimelineCapturedComparison } from './TimelineCapturedComparison';
import { timelineRecordedTime, timelineUtcDay, timelineReviewMatch, timelineWindowValid } from '../utils/timelineReview';
import { useState } from 'react';
import type { TimelineExportSnapshot } from '../utils/timelineReviewExport';

export function TimelineCapturedRows({ rows }: { rows: TimelineExportSnapshot['rows'] }) {
  const [page, setPage] = useState(0), [query, setQuery] = useState('');
  type FacetField = 'entry_type' | 'source' | 'author_email' | 'day';
  const [facets, setFacets] = useState<Partial<Record<FacetField, string | null>>>({});
  const [searchField, setSearchField] = useState('all');
  const [order, setOrder] = useState('captured');
  const [from, setFrom] = useState(''), [through, setThrough] = useState('');
  const windowValid = timelineWindowValid({ author: '', from, through });
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const select = (id: number) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 2 ? [...current, id] : current);
  const needle = query.trim().toLowerCase();
  const validSearch = searchField !== 'id' || !needle || (/^[1-9][0-9]*$/.test(needle) && Number.isSafeInteger(Number(needle)));
  const matching = rows.filter(row => timelineReviewMatch(row, { author: '', from, through }) && (Object.entries(facets) as [FacetField, string | null][]).every(([field, value]) => (field === 'day' ? timelineUtcDay(row.timestamp) : row[field]) === value) && validSearch && (!needle || (searchField === 'id' ? row.id === Number(needle) : (searchField === 'content' ? [row.content] : searchField === 'author' ? [row.author_email] : searchField === 'timestamp' ? [row.timestamp] : searchField === 'type' ? [row.entry_type] : searchField === 'source' ? [row.source] : [String(row.id), row.timestamp, row.entry_type, row.source, row.author_email, row.content]).some(value => value?.toLowerCase().includes(needle)))));
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
      <p>Composition of all {rows.length} frozen captured entries across inspection pages, independent of inspection text and category filters. Counts are entries, not unique evidence, current people or fresh server state. Combine exact categories across type, source, recorded author and UTC day. Categories use AND with each other and inspection text. Choose an active category again to remove it; counts always cover the full frozen capture, not remaining matches. Downloads and comparison selection stay unchanged.</p>
      {(['entry_type', 'source', 'author_email', 'day'] as const).map(field => {
        const counts = new Map<string | null, number>();
        for (const row of rows) { const value = field === 'day' ? timelineUtcDay(row.timestamp) : row[field]; counts.set(value, (counts.get(value) ?? 0) + 1); }
        const label = field === 'entry_type' ? 'Type' : field === 'source' ? 'Source' : field === 'author_email' ? 'Recorded author' : 'Recorded UTC day';
        return <div key={field}><h4 className="font-medium">{label}</h4><div className="mt-1 flex flex-wrap gap-2">{[...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => <button type="button" key={JSON.stringify(value)} aria-pressed={Object.hasOwn(facets, field) && facets[field] === value} onClick={() => { setFacets(current => { const next = { ...current }; if (Object.hasOwn(current, field) && current[field] === value) delete next[field]; else next[field] = value; return next; }); setPage(0); }} className="min-h-9 max-w-full rounded-md border border-surface-600 px-2 text-left [overflow-wrap:anywhere]">{label}: {value === null ? field === 'day' ? '(No usable UTC day)' : '(Not recorded)' : value === '' ? '(Empty saved value)' : value} · {count} {count === 1 ? 'entry' : 'entries'}</button>)}</div></div>;
      })}
      <p>UTC day uses the same recorded timestamp rules as live date filters, not the viewer's local date or an event-order claim. Raw timestamps remain unchanged in inspection and downloads.</p>
    </section>}
    {Object.keys(facets).length > 0 && <div className="my-2 space-y-2 [overflow-wrap:anywhere]">
      <p>All selected inspection categories must match. Categories narrow inspection only, never captured exports.</p>
      {(Object.entries(facets) as [FacetField, string | null][]).map(([field, value]) => <p key={field} role="status">Inspection category: {field} = {value === null ? field === 'day' ? '(No usable UTC day)' : '(Not recorded)' : value === '' ? '(Empty saved value)' : value}. <button type="button" onClick={() => { setFacets(current => { const next = { ...current }; delete next[field]; return next; }); setPage(0); }} className="min-h-9 rounded-md border border-surface-600 px-2">Remove captured {field} category</button></p>)}
      <button type="button" onClick={() => { setFacets({}); setPage(0); }} className="min-h-9 rounded-md border border-surface-600 px-2">Clear captured category</button>
    </div>}
    {(query || searchField !== 'all' || Object.keys(facets).length > 0 || from || through || order !== 'captured' || current > 0) && <button type="button" onClick={() => { setQuery(''); setSearchField('all'); setFacets({}); setFrom(''); setThrough(''); setOrder('captured'); setPage(0); }} className="my-2 min-h-9 rounded-md border border-surface-600 px-2">Reset frozen timeline inspection</button>}
    <p>Reset inspection restores all captured entries in their original order on the first inspection page. Comparison selection, composition visibility, captured exports and live timeline criteria stay unchanged.</p>
    <label className="mt-2 block">Find within captured rows<input type="text" aria-label="Find within captured rows" value={query} onChange={event => { setPage(0); setQuery(event.target.value); }} className="mt-1 min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-2" /></label>
    <label className="my-2 block">Search captured field<select aria-label="Search captured field" value={searchField} onChange={event => { setSearchField(event.target.value); setPage(0); }} className="mt-1 min-h-9 w-full rounded-md border border-surface-600 bg-surface-950 px-2"><option value="all">All captured fields</option><option value="content">Saved text only</option><option value="author">Recorded author only</option><option value="timestamp">Raw timestamp only</option><option value="type">Recorded type only</option><option value="source">Recorded source only</option><option value="id">Exact captured entry ID</option></select></label>
    <p>Field search affects frozen inspection only. Text is a literal case-insensitive substring in the chosen raw field. Exact entry ID requires one positive safe whole-number ID, not a partial ID or text. Empty search keeps all rows within the inspection category. Raw null authors never become invented text.</p>
    {!validSearch && <p role="status" className="my-2 text-warning">Enter one positive whole captured entry ID. No inspection rows match this invalid ID; captured exports remain unchanged.</p>}
    <p className="my-2">The chosen search field and category narrow only this inspection, never captured CSV/JSON rows, capture criteria or live timeline filters.</p>
    <div className="my-2 flex flex-wrap gap-2">
      <label className="flex min-w-0 max-w-full flex-col gap-1">Captured from UTC date<input type="date" aria-label="Captured from UTC date" value={from} onChange={event => { setFrom(event.target.value); setPage(0); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2" /></label>
      <label className="flex min-w-0 max-w-full flex-col gap-1">Captured through UTC date<input type="date" aria-label="Captured through UTC date" value={through} onChange={event => { setThrough(event.target.value); setPage(0); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2" /></label>
      {(from || through) && <button type="button" onClick={() => { setFrom(''); setThrough(''); setPage(0); }} className="min-h-9 rounded-md border border-surface-600 px-2">Clear captured UTC window</button>}
    </div>
    <p>Inclusive UTC dates narrow this frozen inspection together with text and exact categories. No window keeps entries with unusable timestamps; a window excludes them. Offset timestamps use their recorded UTC day; timezone-free timestamps follow the existing UTC convention. Capture criteria, exports and live date filters stay unchanged.</p>
    {!windowValid && <p role="status" className="my-2 text-warning">Captured UTC date window is invalid. No inspection rows match; captured exports and comparison selection remain unchanged.</p>}
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
