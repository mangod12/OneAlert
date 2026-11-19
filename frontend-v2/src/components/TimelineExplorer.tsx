import { useMemo, useState, type ReactNode } from 'react';

export interface TimelineRecord {
  id: number;
  timestamp: string;
  entry_type: string;
  source: string;
  content: string;
  author_email: string | null;
}

export function TimelineExplorer<T extends TimelineRecord>({ entries, pinnedIds = [], children }: {
  entries: T[];
  pinnedIds?: number[];
  children: (entry: T) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [order, setOrder] = useState('original');
  const kinds = [...new Set(entries.map(e => e.entry_type))].sort();
  const sources = [...new Set(entries.map(e => e.source))].sort();
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => (!kind || entry.entry_type === kind) && (!source || entry.source === source)
      && (!needle || [entry.content, entry.author_email, entry.source, entry.entry_type, String(entry.id)].some(value => value?.toLowerCase().includes(needle))));
  }, [entries, query, kind, source]);
  const pinned = entries.filter(entry => pinnedIds.includes(entry.id) && !matches.some(match => match.id === entry.id));
  const shown = [...matches, ...pinned];
  if (order !== 'original') shown.sort((a, b) => {
    const aTime = Date.parse(a.timestamp), bTime = Date.parse(b.timestamp);
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : a.id - b.id;
    if (!Number.isFinite(bTime)) return -1;
    return (order === 'newest' ? bTime - aTime : aTime - bTime) || a.id - b.id;
  });
  const filtered = !!query || !!kind || !!source || order !== 'original';
  const clear = () => { setQuery(''); setKind(''); setSource(''); setOrder('original'); };
  if (!entries.length) return <p className="text-surface-500">No timeline entries yet.</p>;
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
        {filtered && <button type="button" onClick={clear} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">Clear timeline filters</button>}
      </div>
      <p role="status" className="mt-2 text-xs text-surface-400">{matches.length} of {entries.length} loaded entries match. Filters affect this view only, not the full timeline CSV.</p>
      {pinned.length > 0 && <p className="mt-1 text-xs text-primary-300">{pinned.length} linked or edited {pinned.length === 1 ? 'entry is' : 'entries are'} kept visible outside these filters.</p>}
    </div>
    {shown.length ? <div className="space-y-4">{shown.map(children)}</div> : <p className="py-4 text-sm text-surface-400">No timeline entries match. Clear filters to see the loaded timeline.</p>}
  </>;
}
