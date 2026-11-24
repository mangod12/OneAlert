import { watchlistDrilldown, type WatchlistMetric } from '../utils/watchlistDrilldown';
import { WatchlistPageExport } from './WatchlistPageExport';
import { watchlistPageSnapshot, type WatchPageExport } from '../utils/watchlistPageExport';
import { SavedViewsMenu } from './SavedViewsMenu';
import { checkedWatchlistView } from '../utils/watchlistViews';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface WatchedRecord { kind: 'alert' | 'case'; id: number; title: string; cve_id: string | null; asset_name: string | null; severity: string | null; status: string | null; created_at: string | null; due_date: string | null }
interface WorkloadSummary { alerts: number; cases: number; active: number; done: number; overdue: number; active_without_due_date: number }
interface Result { summary?: WorkloadSummary; data: WatchedRecord[]; total: number; page: number; size: number; date_basis: string }
const style = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-200 disabled:opacity-40';
interface WatchScope { query: string; kind: string; severity: string; scope: string; sort: string }
const defaults: WatchScope = { query: '', kind: 'all', severity: 'all', scope: 'all', sort: 'severity' };
const choices = { kind: ['all', 'alert', 'case'], severity: ['all', 'critical', 'high', 'medium', 'low', 'info'], scope: ['all', 'active', 'done', 'overdue', 'today', 'future', 'undated'], sort: ['severity', 'newest', 'oldest', 'name', 'due'] };
function parseScope(params: URLSearchParams): WatchScope | null {
  if (['explore', ...Object.keys(defaults)].some(field => params.getAll(field).length > 1) || (params.has('explore') && params.get('explore') !== '1')) return null;
  const restored = { ...defaults, ...Object.fromEntries(Object.keys(defaults).filter(key => params.has(key)).map(key => [key, params.get(key)!])) };
  if (restored.query.length > 200 || Object.entries(choices).some(([key, values]) => !values.includes(restored[key as keyof WatchScope]))) return null;
  return { ...restored, query: restored.query.trim() };
}
export function WatchlistExplorer() {
  const [params] = useSearchParams();
  return <WatchlistSearch key={params.toString()} initial={parseScope(params)} />;
}
function WatchlistSearch({ initial }: { initial: WatchScope | null }) {
  const [draft, setDraft] = useState(initial?.query ?? ''), [query, setQuery] = useState(initial?.query ?? ''), [kind, setKind] = useState(initial?.kind ?? 'all'), [severity, setSeverity] = useState(initial?.severity ?? 'all'), [scope, setScope] = useState(initial?.scope ?? 'all'), [sort, setSort] = useState(initial?.sort ?? 'severity');
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0), [result, setResult] = useState<Result | null>(null), [error, setError] = useState('');
  const [exportSnapshot, setExportSnapshot] = useState<WatchPageExport | null>(null);
  const [loadedAt, setLoadedAt] = useState('');
  const [viewNotice, setViewNotice] = useState('');
  const [drillNotice, setDrillNotice] = useState('');
  const [beforeDrilldown, setBeforeDrilldown] = useState<{ filters: WatchScope; draft: string; page: number } | null>(null);
  const [invalid, setInvalid] = useState(!initial), [copyStatus, setCopyStatus] = useState(''); const copies = useRef(0);
  useEffect(() => {
    if (invalid) return;
    let cancelled = false; setResult(null); setError('');
    apiClient.get<Result>('/cases/watched-record-explorer', { params: { page, size: 25, query, kind, severity, scope, sort } })
      .then(response => { if (!cancelled) { setResult(response.data); setLoadedAt(new Date().toISOString()); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'The complete watchlist search could not be loaded.')); });
    return () => { cancelled = true; };
  }, [page, retry, query, kind, severity, scope, sort, invalid]);
  useEffect(() => { copies.current += 1; setCopyStatus(''); return () => { copies.current += 1; }; }, [query, kind, severity, scope, sort]);
  async function copySearch() {
    const id = ++copies.current; setCopyStatus('');
    const url = new URL('/app/watchlist', window.location.origin); url.searchParams.set('explore', '1');
    for (const [key, value] of Object.entries({ query, kind, severity, scope, sort })) if (value !== defaults[key as keyof WatchScope]) url.searchParams.set(key, value);
    try { await navigator.clipboard.writeText(url.toString()); if (id === copies.current) setCopyStatus('Applied watchlist search link copied. Opening it reads only records currently followed by the viewer, not this result snapshot.'); }
    catch { if (id === copies.current) setCopyStatus('Copy unavailable. Your applied watchlist search is unchanged.'); }
  }
  const summary = result?.summary;
  const summaryValid = summary && Object.values(summary).every(value => Number.isSafeInteger(value) && value >= 0) && summary.alerts + summary.cases === result!.total && summary.active + summary.done === result!.total && summary.overdue <= summary.active && summary.active_without_due_date <= summary.active - summary.overdue && (kind !== 'alert' || summary.cases === 0) && (kind !== 'case' || summary.alerts === 0) && (scope !== 'active' || summary.done === 0) && (scope !== 'done' || summary.active === 0) && (scope !== 'overdue' || summary.overdue === result!.total) && (!['today', 'future', 'undated'].includes(scope) || (summary.done === 0 && summary.overdue === 0)) && (scope !== 'undated' || summary.active_without_due_date === result!.total) && (!['today', 'future'].includes(scope) || summary.active_without_due_date === 0);
  const pages = result ? Math.max(1, Math.ceil(result.total / 25)) : 1;
  return <section aria-label="Search entire watchlist" className="oa-panel space-y-4 p-4">
    <h2 className="text-base font-semibold text-surface-100">Search entire watchlist</h2>
    <p className="text-xs text-surface-400">Search and rank all alert and investigation records you currently follow, beyond the loaded review list. This read-only search does not change your watch subscriptions. Open an exact record to work on it.</p>
    {invalid && <p role="alert" className="text-sm text-danger">This watchlist search link is invalid or ambiguous. No full-watchlist query was run. Submit a new search or clear the filters to continue.</p>}
    <section aria-label="Private saved watchlist filters" className="space-y-2 rounded border border-surface-700 p-3"><h3 className="text-sm font-semibold text-surface-100">Your saved watchlist views</h3><p className="text-xs text-surface-400">Save applied keywords, type, severity, work scope and order, not search drafts, result pages, records or watch subscriptions. Views are private to your account. Restoring replaces the search draft and reloads page 1 using only records you currently follow. Due scopes are recalculated using the server's current UTC date, not the date the view was saved. No record access, subscription, message or task change is granted.</p>
      <SavedViewsMenu basePath="/cases/watchlist-views/" currentFilters={{ query, kind, severity, scope, sort }} onApply={value => {
        const next = checkedWatchlistView(value);
        if (!next) { setViewNotice('Saved watchlist view is invalid. Current filters, draft and results were not changed.'); return; }
        setInvalid(false); setDraft(next.query); setQuery(next.query); setKind(next.kind); setSeverity(next.severity); setScope(next.scope); setSort(next.sort); setPage(1); setResult(null); setRetry(value => value + 1); setViewNotice('Applied saved watchlist filters. Current followed records are reloaded from page 1 using the current UTC date.');
      }} />{viewNotice && <p role="status" className="text-xs text-warning">{viewNotice}</p>}
    </section>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setInvalid(false); setQuery(draft.trim()); setPage(1); }}>
      <input aria-label="Search all watched records" type="search" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Title, CVE, asset name or record ID" className={`${style} min-w-0 flex-1 basis-full sm:basis-0`} />
      <button type="submit" className={style}>Search all followed records</button>
    </form>
    {draft.trim() !== query && <p className="text-xs text-warning">Search draft not applied. Results still use {query ? `"${query}"` : 'all keywords'}.</p>}
    <div className="flex flex-wrap gap-2">
      <label className="flex flex-col gap-1 text-xs text-surface-400">Record type<select aria-label="Full watchlist type" className={style} value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="all">All record types</option><option value="alert">Alerts</option><option value="case">Investigations</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Severity<select aria-label="Full watchlist severity" className={style} value={severity} onChange={event => { setSeverity(event.target.value); setPage(1); }}><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Work scope<select aria-label="Full watchlist scope" className={style} value={scope} onChange={event => { setScope(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active records</option><option value="done">Resolved / closed / false positive</option><option value="overdue">Overdue alerts and investigations</option><option value="today">Active due today (UTC)</option><option value="future">Active due after today (UTC)</option><option value="undated">Active without due date</option></select></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Order<select aria-label="Full watchlist order" className={style} value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="severity">Severity first</option><option value="newest">Newest created first</option><option value="oldest">Oldest created first</option><option value="name">Name A to Z</option><option value="due">Earliest due date first</option></select></label>
    </div>
    <div className="flex flex-wrap gap-2"><button type="button" className={style} onClick={() => { setInvalid(false); setDraft(''); setQuery(''); setKind('all'); setSeverity('all'); setScope('all'); setSort('severity'); setPage(1); }}>Clear full watchlist filters</button><button type="button" className={style} onClick={() => setRetry(value => value + 1)}>Refresh full watchlist results</button></div>
    <p className="text-xs text-surface-400">Active excludes resolved, closed and false-positive records. Overdue includes both alert triage dates and investigation due dates before today in UTC, excluding those completed statuses. Due today and future use that same UTC date. Without due date includes only active records with no date, not overdue work. Counts and pages are current reads, not an atomic snapshot or watch history.</p>
    {!invalid && <section aria-label="Watchlist search handoff" className="space-y-2 text-xs text-surface-400"><button type="button" className={style} onClick={() => void copySearch()}>Copy applied watchlist search link</button><p>Includes applied keywords, type, severity, work scope and order, never draft edits, result records or pagination. Query details are visible in the link, so share them only with an appropriate audience. It grants no access and does not subscribe anyone to your records. Each viewer sees only their own current followed records.</p>{copyStatus && <p role="status">{copyStatus}</p>}</section>}
    {beforeDrilldown && <section aria-label="Return to watchlist search before drilldown" className="space-y-2 rounded border border-primary-500/30 p-3 text-xs text-surface-300 [overflow-wrap:anywhere]"><h3 className="font-semibold">Search before the last workload drilldown</h3><p>Applied keywords: {beforeDrilldown.filters.query || 'all keywords'}; type: {beforeDrilldown.filters.kind}; severity: {beforeDrilldown.filters.severity}; work scope: {beforeDrilldown.filters.scope}; order: {beforeDrilldown.filters.sort}; page: {beforeDrilldown.page}.</p><p>Return replaces your current filters and draft with the earlier applied criteria and its separate draft, then reloads that page. Records, counts and the UTC date can change. This is one return point, replaced by the next count drilldown, not a saved view, result snapshot or watch history. No follows, records or access change.</p><button type="button" className={`${style} min-h-11`} onClick={() => {
      const prior = beforeDrilldown; setDraft(prior.draft); setQuery(prior.filters.query); setKind(prior.filters.kind); setSeverity(prior.filters.severity); setScope(prior.filters.scope); setSort(prior.filters.sort); setPage(prior.page); setResult(null); setRetry(value => value + 1); setBeforeDrilldown(null); setDrillNotice('Returned to the search before the last workload drilldown. Earlier applied criteria and separate draft restored; current records reloaded, not a saved result snapshot.');
    }}>Return to search before last workload drilldown</button></section>}
    {!invalid && (error ? <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={style} onClick={() => setRetry(value => value + 1)}>Retry full watchlist search</button></div> : !result ? <p role="status" className="text-sm text-surface-400">Searching all followed records...</p> : <>
      <p role="status" className="text-sm text-surface-300">{result.total} followed records match across your entire watchlist. Showing {result.data.length} on page {page} of {pages}. UTC date basis: {result.date_basis}.</p>
      <section aria-label="Full matching watchlist workload" className="space-y-2 rounded border border-surface-700 p-3"><h3 className="text-sm font-semibold text-surface-200">Full matching workload</h3><p className="text-xs text-surface-400">Across all result pages with the applied filters, not the {result.data.length} visible rows. Missing due dates are not counted as overdue. These are current followed records, not all assigned work or a historical snapshot.</p><p className="text-xs text-surface-400">Open a count to search its exact matching subset from page 1, keeping applied keywords, severity and order. This replaces any search draft. Counts with incompatible work scopes are not links. This reloads current records and does not change follows or records.</p>{drillNotice && <p role="status" className="text-xs text-warning">{drillNotice}</p>}{summaryValid ? <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{([['alerts', 'Followed alerts'], ['cases', 'Followed investigations'], ['active', 'Active records'], ['done', 'Completed records'], ['overdue', 'Active overdue records (UTC)'], ['active_without_due_date', 'Active records without due date']] as [WatchlistMetric, string][]).map(([metric, label]) => {
        const next = watchlistDrilldown({ query, kind, severity, scope, sort }, metric);
        return <div key={metric}><dt className="text-surface-400">{label}</dt><dd className="mt-1 text-base font-semibold text-surface-100">{next ? <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-start rounded text-primary-300 underline decoration-primary-300/40 underline-offset-4 hover:text-primary-200 focus-visible:outline-2 focus-visible:outline-primary-300" aria-label={`Explore ${label.toLowerCase()}: ${summary[metric]} matching records`} onClick={() => {
          setBeforeDrilldown({ filters: { query, kind, severity, scope, sort }, draft, page }); setDraft(next.query); setQuery(next.query); setKind(next.kind); setSeverity(next.severity); setScope(next.scope); setSort(next.sort); setPage(1); setResult(null); setRetry(value => value + 1); setDrillNotice(`Opened ${label.toLowerCase()} from the matching workload. Applied criteria retained; search draft replaced. Current records reloaded from page 1, so counts can change.`);
        }}>{summary[metric]}</button> : summary[metric]}</dd></div>;
      })}</dl> : <p role="status" className="text-xs text-warning">Matching workload totals are unavailable or inconsistent. No totals were inferred from this page. Refresh to request them again.</p>}</section>
      <button type="button" className={style} disabled={watchlistPageSnapshot(result, page, { query, kind, severity, scope, sort }, loadedAt, '') === null} onClick={() => setExportSnapshot(watchlistPageSnapshot(result, page, { query, kind, severity, scope, sort }, loadedAt, new Date().toISOString()))}>Review this watchlist page CSV ({result.data.length} records only)</button>
      {!result.data.length && <p className="text-sm text-surface-400">No followed records match this page and these filters.{page > 1 ? ' Records may have moved. Return to the first page.' : ' Try other filters or follow an alert or investigation.'}</p>}
      <ul aria-label="Full watchlist results" className="space-y-3">{result.data.map(row => <li key={`${row.kind}-${row.id}`} className="min-w-0 space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
        <p className="break-words">{row.kind === 'alert' ? 'Alert' : 'Investigation'} #{row.id} · {row.severity ?? 'Severity not recorded'} · {row.status ?? 'Status not recorded'}</p>
        <Link className="block break-words text-sm font-medium text-primary-300 [overflow-wrap:anywhere]" to={row.kind === 'alert' ? `/alerts?alert=${row.id}` : `/cases/${row.id}`}>{row.title}</Link>
        {row.cve_id && <p className="break-words">{row.cve_id}</p>}{row.asset_name && <p className="break-words">Asset: {row.asset_name}</p>}
        <p className="break-words">Created: {row.created_at ? new Date(row.created_at).toLocaleString() : 'Not recorded'} · Due: {row.due_date ?? 'No date recorded'}</p>
      </li>)}</ul>
      <nav aria-label="Full watchlist pages" className="flex flex-wrap items-center gap-2"><button type="button" className={style} disabled={page === 1} onClick={() => setPage(1)}>First watched page</button><button type="button" className={style} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous watched page</button><button type="button" className={style} disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next watched page</button></nav>
    </>)}
    {exportSnapshot && <WatchlistPageExport snapshot={exportSnapshot} onClose={() => setExportSnapshot(null)} />}
  </section>;
}
