import { TimelineCapturedRows } from './TimelineCapturedRows';
import { timelineSearchMatch, timelineSearchValid, type TimelineSearchField } from '../utils/timelineSearch';
import { timelineComposition, timelineDayComposition } from '../utils/timelineComposition';
import { timelineReviewCsv, timelineReviewJson, type TimelineExportSnapshot } from '../utils/timelineReviewExport';
import { timelineRecordedTime, timelineReviewMatch, timelineWindowValid } from '../utils/timelineReview';
import { useMemo, useState, type ReactNode } from 'react';

export interface TimelineRecord {
  id: number;
  timestamp: string;
  entry_type: string;
  source: string;
  content: string;
  author_email: string | null;
}

export function TimelineExplorer<T extends TimelineRecord>({ entries, pinnedIds = [], exportContext, children }: {
  entries: T[];
  pinnedIds?: number[];
  exportContext?: { caseId: number; title: string };
  children: (entry: T) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<TimelineExportSnapshot | null>(null);
  const [page, setPage] = useState(0);
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [returnPoint, setReturnPoint] = useState<null | { searchField: TimelineSearchField; query: string; kind: string; source: string; order: string; author: string; from: string; through: string; page: number }>(null);
  const [searchField, setSearchField] = useState<TimelineSearchField>('all');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [order, setOrder] = useState('original');
  const [author, setAuthor] = useState(''), [from, setFrom] = useState(''), [through, setThrough] = useState('');
  const authors = [...new Set(entries.map(entry => entry.author_email).filter((value): value is string => !!value))].sort();
  const validWindow = timelineWindowValid({ author, from, through });
  const kinds = [...new Set(entries.map(e => e.entry_type))].sort();
  const sources = [...new Set(entries.map(e => e.source))].sort();
  const matches = useMemo(() => {
    return entries.filter(entry => timelineReviewMatch(entry, { author, from, through }) && (!kind || entry.entry_type === kind) && (!source || entry.source === source)
      && timelineSearchMatch(entry, query, searchField));
  }, [entries, query, searchField, kind, source, author, from, through]);
  const composition = timelineComposition(matches), dayComposition = timelineDayComposition(matches);
  const narrow = (facet: 'kind' | 'source' | 'author' | 'day', value: string) => {
    setReturnPoint({ searchField, query, kind, source, order, author, from, through, page: current }); setPage(0);
    if (facet === 'kind') setKind(value); else if (facet === 'source') setSource(value); else if (facet === 'author') setAuthor(value); else { setFrom(value); setThrough(value); }
  };
  const restore = () => { if (!returnPoint) return; const r = returnPoint; setSearchField(r.searchField); setQuery(r.query); setKind(r.kind); setSource(r.source); setOrder(r.order); setAuthor(r.author); setFrom(r.from); setThrough(r.through); setPage(r.page); setReturnPoint(null); };
  const pinned = entries.filter(entry => pinnedIds.includes(entry.id) && !matches.some(match => match.id === entry.id));
  const shown = [...matches, ...pinned];
  if (order !== 'original') shown.sort((a, b) => {
    const aTime = timelineRecordedTime(a.timestamp), bTime = timelineRecordedTime(b.timestamp);
    if (aTime === null) return bTime !== null ? 1 : a.id - b.id;
    if (bTime === null) return -1;
    return (order === 'newest' ? bTime - aTime : aTime - bTime) || a.id - b.id;
  });
  const capture = () => {
    if (!exportContext || !validWindow || !timelineSearchValid(query, searchField) || !matches.length) return;
    const matchingIds = new Set(matches.map(entry => entry.id));
    setSnapshot({ ...exportContext, capturedAt: new Date().toISOString(), loadedCount: entries.length, excludedPinnedCount: pinned.length, filters: { searchField, query, kind, source, order, author, from, through }, rows: shown.filter(entry => matchingIds.has(entry.id)).map(entry => ({ id: entry.id, timestamp: entry.timestamp, entry_type: entry.entry_type, source: entry.source, content: entry.content, author_email: entry.author_email })) });
  };
  const download = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([timelineReviewCsv(snapshot)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `case-${snapshot.caseId}-loaded-timeline-review.csv`; link.click(); URL.revokeObjectURL(url); setSnapshot(null);
  };
  const downloadJson = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([timelineReviewJson(snapshot)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `case-${snapshot.caseId}-loaded-timeline-review.json`; link.click(); URL.revokeObjectURL(url); setSnapshot(null);
  };
  const matchingIds = new Set(matches.map(entry => entry.id));
  const orderedMatches = shown.filter(entry => matchingIds.has(entry.id));
  const pages = Math.max(1, Math.ceil(orderedMatches.length / 20)), current = Math.min(page, pages - 1);
  const pageMatches = orderedMatches.slice(current * 20, (current + 1) * 20);
  const outsidePinned = shown.filter(entry => pinnedIds.includes(entry.id) && !pageMatches.some(match => match.id === entry.id));
  const matchingPinsOutsidePage = outsidePinned.filter(entry => matchingIds.has(entry.id)).length;
  const visibleIds = new Set([...pageMatches, ...outsidePinned].map(entry => entry.id));
  const visible = shown.filter(entry => visibleIds.has(entry.id));
  const filtered = searchField !== 'all' || !!query || !!kind || !!source || !!author || !!from || !!through || order !== 'original';
  const clear = () => { setReturnPoint(null); setPage(0); setSearchField('all'); setQuery(''); setKind(''); setSource(''); setOrder('original'); setAuthor(''); setFrom(''); setThrough(''); };
  if (!entries.length && !snapshot && !returnPoint) return <p className="text-surface-500">No timeline entries yet.</p>;
  return <>
    <div className="mb-4 rounded-md border border-surface-700 bg-surface-950/50 p-3">
      <label htmlFor="timeline-query" className="block text-xs font-medium text-surface-300">Find timeline evidence</label>
      <input id="timeline-query" type="search" value={query} onChange={event => { setPage(0); setQuery(event.target.value); }} placeholder="Search text, author or entry ID"
        className="mt-1 min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-100" />
      <label className="mt-2 flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">Search within<select aria-label="Timeline search field" value={searchField} onChange={event => { setPage(0); setSearchField(event.target.value as TimelineSearchField); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200"><option value="all">All searchable fields</option><option value="content">Saved entry text only</option><option value="author">Recorded author text only</option><option value="id">Exact entry ID only</option></select></label>
      <p className="mt-1 text-xs text-surface-400">Text search is a case-insensitive substring in the selected field. Exact entry ID accepts one positive whole ID, not a partial ID, source ID or note text. Empty search keeps all entries within the other criteria.</p>
      {!timelineSearchValid(query, searchField) && <p role="alert" className="mt-1 text-xs text-warning">Enter one positive whole entry ID without spaces, signs or leading zeros. No entries match this invalid ID; linked or edited entries may remain visible separately.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Timeline entry type" value={kind} onChange={event => { setPage(0); setKind(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="">All entry types</option>{kinds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Timeline source" value={source} onChange={event => { setPage(0); setSource(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="">All sources</option>{sources.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Timeline order" value={order} onChange={event => { setPage(0); setOrder(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="original">Recorded order</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">Recorded author<select aria-label="Timeline recorded author" value={author} onChange={event => { setPage(0); setAuthor(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200"><option value="">All recorded authors</option><option value="unrecorded">Author not recorded</option>{authors.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">From UTC date<input type="date" aria-label="Timeline from UTC date" value={from} onChange={event => { setPage(0); setFrom(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200" /></label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">Through UTC date<input type="date" aria-label="Timeline through UTC date" value={through} onChange={event => { setPage(0); setThrough(event.target.value); }} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200" /></label>
        {filtered && <button type="button" onClick={clear} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">Clear timeline filters</button>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" aria-expanded={compositionOpen} onClick={() => setCompositionOpen(!compositionOpen)} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">{compositionOpen ? 'Hide matching timeline composition' : 'Explore matching timeline composition'}</button>
        {returnPoint && <button type="button" onClick={restore} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">Return to prior timeline criteria</button>}
      </div>
      {compositionOpen && <section aria-label="Matching timeline composition" className="mt-3 space-y-3 rounded-md border border-surface-700 p-3 text-xs text-surface-300">
        <p>{matches.length} matching loaded entries across all matching pages. Counts include each entry once within each category, not unique evidence sources, current team members or activity outside this loaded timeline. Outside-filter linked or edited entries are excluded. Choose a count to narrow the current criteria; a single prior criteria return point is retained, not historical results.</p>
        {composition.length ? composition.map(group => <div key={group.facet}><h4 className="mb-1 font-medium text-surface-100">{group.label}</h4><div className="flex flex-wrap gap-2">{group.rows.map(row => <button type="button" key={row.value} onClick={() => narrow(group.facet, row.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 px-2 text-left [overflow-wrap:anywhere]">{row.label}: {row.count} {row.count === 1 ? 'entry' : 'entries'}</button>)}</div></div>) : <p>No matching entries to summarize. No wider timeline scope was substituted.</p>}
        <div><h4 className="mb-1 font-medium text-surface-100">Recorded UTC days</h4><p className="mb-2">Newest UTC day first, using the same recorded timestamp rules as date filters, not displayed local dates. Choose a day to set both inclusive UTC boundaries while retaining other criteria. This does not establish an event sequence or elapsed response time.</p><div className="flex flex-wrap gap-2">{dayComposition.days.map(row => <button type="button" key={row.day} onClick={() => narrow('day', row.day)} className="min-h-9 rounded-md border border-surface-600 px-2">UTC {row.day}: {row.count} {row.count === 1 ? 'entry' : 'entries'}</button>)}</div>{dayComposition.undated > 0 && <p className="mt-2 text-warning">{dayComposition.undated} matching {dayComposition.undated === 1 ? 'entry has' : 'entries have'} no usable recorded UTC day. These remain in the current matching count only when no date boundary is set, and are not assigned to a calendar day.</p>}{!dayComposition.days.length && <p>No usable UTC day in these matching entries.</p>}</div>
      </section>}
      {exportContext && <button type="button" disabled={!validWindow || !timelineSearchValid(query, searchField) || !matches.length} onClick={capture} className="mt-3 min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200 disabled:opacity-50">Review matching timeline CSV</button>}
      {snapshot && <section aria-label="Matching timeline CSV review" className="mt-3 space-y-2 rounded-md border border-primary-700 p-3 text-xs text-surface-200">
        <p>Captured review for investigation #{snapshot.caseId}: {snapshot.title}</p>
        <p>{snapshot.rows.length} matching entries of {snapshot.loadedCount} loaded. {snapshot.excludedPinnedCount} outside-filter linked or edited entries excluded. All captured loaded matches, not just the visible page. Only this loaded matching review, not the full timeline, edit history or audit evidence. Captured {snapshot.capturedAt}.</p>
        <p className="break-words">Captured criteria: search field {snapshot.filters.searchField || 'all'}; text {snapshot.filters.query || 'any'}; type {snapshot.filters.kind || 'any'}; source {snapshot.filters.source || 'any'}; author {snapshot.filters.author || 'any'}; UTC dates {snapshot.filters.from || 'unbounded'} through {snapshot.filters.through || 'unbounded'}; order {snapshot.filters.order}. Later filter or record changes do not change this captured review. No unsaved note edits are included.</p>
        <TimelineCapturedRows key={snapshot.capturedAt} rows={snapshot.rows} />
        <button type="button" onClick={download} className="min-h-9 rounded-md bg-primary-500 px-2 text-surface-950">Download captured matching CSV</button>
        <p>JSON contains the same captured matching entries in captured order, with typed IDs/counts, exact raw timestamps and author nulls. Saved text is raw text without CSV spreadsheet-formula protection. Treat text as untrusted data, not executable instructions. Inspection search and comparison selection never narrow the download.</p>
        <button type="button" onClick={downloadJson} className="min-h-9 rounded-md border border-surface-600 px-2">Download captured matching JSON</button>
        <button type="button" onClick={() => setSnapshot(null)} className="ml-2 min-h-9 rounded-md border border-surface-600 px-2">Discard captured review</button>
      </section>}
      <p role="status" className="mt-2 text-xs text-surface-400">{matches.length} of {entries.length} loaded entries match. Filters affect this view only, not the full timeline CSV.</p>
      <p className="mt-1 text-xs text-surface-400">Author means the exact recorded author email, not the source, case owner or current team membership. UTC dates include both endpoints using recorded timestamps, not displayed local dates. Server timestamps without a timezone are treated as UTC. Missing or invalid timestamps are excluded only when a date boundary is set. No timeline records or export scope change.</p>
      {!validWindow && <p role="alert" className="mt-1 text-xs text-warning">Choose valid UTC dates with From on or before Through. No entries match this invalid window; linked or edited entries may remain visible separately.</p>}
      {author && author !== 'unrecorded' && !authors.includes(author) && <p className="mt-1 text-xs text-warning">The selected author is no longer present in the loaded timeline. No broader author scope was substituted.</p>}
      {pinned.length > 0 && <p className="mt-1 text-xs text-primary-300">{pinned.length} linked or edited {pinned.length === 1 ? 'entry is' : 'entries are'} kept visible outside these filters.</p>}
    </div>
    {matches.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-surface-300" aria-label="Timeline matching pages">
      <span>Matching entries {current * 20 + 1}-{Math.min((current + 1) * 20, matches.length)} of {matches.length}. Page {current + 1} of {pages}. Outside-filter linked or edited entries stay visible separately. CSV review includes all loaded matches, not just this page.</span>
      {pages > 1 && <><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Previous matching entries</button><button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="min-h-9 rounded-md border border-surface-600 px-2 disabled:opacity-50">Next matching entries</button></>}
    </div>}
    {matchingPinsOutsidePage > 0 && <p className="mb-3 text-xs text-primary-300">{matchingPinsOutsidePage} matching linked or edited {matchingPinsOutsidePage === 1 ? 'entry is' : 'entries are'} kept visible from another matching page, without changing matching counts or export scope.</p>}
    {visible.length ? <div className="space-y-4">{visible.map(children)}</div> : <p className="py-4 text-sm text-surface-400">No timeline entries match. Clear filters to see the loaded timeline.</p>}
  </>;
}
