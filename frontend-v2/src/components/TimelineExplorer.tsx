import { timelineReviewCsv, type TimelineExportSnapshot } from '../utils/timelineReviewExport';
import { timelineReviewMatch, timelineWindowValid } from '../utils/timelineReview';
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
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => timelineReviewMatch(entry, { author, from, through }) && (!kind || entry.entry_type === kind) && (!source || entry.source === source)
      && (!needle || [entry.content, entry.author_email, entry.source, entry.entry_type, String(entry.id)].some(value => value?.toLowerCase().includes(needle))));
  }, [entries, query, kind, source, author, from, through]);
  const pinned = entries.filter(entry => pinnedIds.includes(entry.id) && !matches.some(match => match.id === entry.id));
  const shown = [...matches, ...pinned];
  if (order !== 'original') shown.sort((a, b) => {
    const aTime = Date.parse(a.timestamp), bTime = Date.parse(b.timestamp);
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : a.id - b.id;
    if (!Number.isFinite(bTime)) return -1;
    return (order === 'newest' ? bTime - aTime : aTime - bTime) || a.id - b.id;
  });
  const capture = () => {
    if (!exportContext || !validWindow || !matches.length) return;
    const matchingIds = new Set(matches.map(entry => entry.id));
    setSnapshot({ ...exportContext, capturedAt: new Date().toISOString(), loadedCount: entries.length, excludedPinnedCount: pinned.length, filters: { query, kind, source, order, author, from, through }, rows: shown.filter(entry => matchingIds.has(entry.id)).map(entry => ({ id: entry.id, timestamp: entry.timestamp, entry_type: entry.entry_type, source: entry.source, content: entry.content, author_email: entry.author_email })) });
  };
  const download = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([timelineReviewCsv(snapshot)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `case-${snapshot.caseId}-loaded-timeline-review.csv`; link.click(); URL.revokeObjectURL(url); setSnapshot(null);
  };
  const filtered = !!query || !!kind || !!source || !!author || !!from || !!through || order !== 'original';
  const clear = () => { setQuery(''); setKind(''); setSource(''); setOrder('original'); setAuthor(''); setFrom(''); setThrough(''); };
  if (!entries.length && !snapshot) return <p className="text-surface-500">No timeline entries yet.</p>;
  return <>
    <div className="mb-4 rounded-md border border-surface-700 bg-surface-950/50 p-3">
      <label htmlFor="timeline-query" className="block text-xs font-medium text-surface-300">Find timeline evidence</label>
      <input id="timeline-query" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search text, author or entry ID"
        className="mt-1 min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-100" />
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Timeline entry type" value={kind} onChange={event => setKind(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="">All entry types</option>{kinds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Timeline source" value={source} onChange={event => setSource(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="">All sources</option>{sources.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Timeline order" value={order} onChange={event => setOrder(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="original">Recorded order</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">Recorded author<select aria-label="Timeline recorded author" value={author} onChange={event => setAuthor(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200"><option value="">All recorded authors</option><option value="unrecorded">Author not recorded</option>{authors.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">From UTC date<input type="date" aria-label="Timeline from UTC date" value={from} onChange={event => setFrom(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200" /></label>
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-surface-400">Through UTC date<input type="date" aria-label="Timeline through UTC date" value={through} onChange={event => setThrough(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200" /></label>
        {filtered && <button type="button" onClick={clear} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">Clear timeline filters</button>}
      </div>
      {exportContext && <button type="button" disabled={!validWindow || !matches.length} onClick={capture} className="mt-3 min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200 disabled:opacity-50">Review matching timeline CSV</button>}
      {snapshot && <section aria-label="Matching timeline CSV review" className="mt-3 space-y-2 rounded-md border border-primary-700 p-3 text-xs text-surface-200">
        <p>Captured review for investigation #{snapshot.caseId}: {snapshot.title}</p>
        <p>{snapshot.rows.length} matching entries of {snapshot.loadedCount} loaded. {snapshot.excludedPinnedCount} outside-filter linked or edited entries excluded. Only this loaded matching review, not the full timeline, edit history or audit evidence. Captured {snapshot.capturedAt}.</p>
        <p className="break-words">Captured criteria: text {snapshot.filters.query || 'any'}; type {snapshot.filters.kind || 'any'}; source {snapshot.filters.source || 'any'}; author {snapshot.filters.author || 'any'}; UTC dates {snapshot.filters.from || 'unbounded'} through {snapshot.filters.through || 'unbounded'}; order {snapshot.filters.order}. Later filter or record changes do not change this captured review. No unsaved note edits are included.</p>
        <button type="button" onClick={download} className="min-h-9 rounded-md bg-primary-500 px-2 text-surface-950">Download captured matching CSV</button>
        <button type="button" onClick={() => setSnapshot(null)} className="ml-2 min-h-9 rounded-md border border-surface-600 px-2">Discard captured review</button>
      </section>}
      <p role="status" className="mt-2 text-xs text-surface-400">{matches.length} of {entries.length} loaded entries match. Filters affect this view only, not the full timeline CSV.</p>
      <p className="mt-1 text-xs text-surface-400">Author means the exact recorded author email, not the source, case owner or current team membership. UTC dates include both endpoints using recorded timestamps, not displayed local dates. Server timestamps without a timezone are treated as UTC. Missing or invalid timestamps are excluded only when a date boundary is set. No timeline records or export scope change.</p>
      {!validWindow && <p role="alert" className="mt-1 text-xs text-warning">Choose valid UTC dates with From on or before Through. No entries match this invalid window; linked or edited entries may remain visible separately.</p>}
      {author && author !== 'unrecorded' && !authors.includes(author) && <p className="mt-1 text-xs text-warning">The selected author is no longer present in the loaded timeline. No broader author scope was substituted.</p>}
      {pinned.length > 0 && <p className="mt-1 text-xs text-primary-300">{pinned.length} linked or edited {pinned.length === 1 ? 'entry is' : 'entries are'} kept visible outside these filters.</p>}
    </div>
    {shown.length ? <div className="space-y-4">{shown.map(children)}</div> : <p className="py-4 text-sm text-surface-400">No timeline entries match. Clear filters to see the loaded timeline.</p>}
  </>;
}
