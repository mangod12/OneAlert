import { loadedWatchlistSearch } from '../utils/loadedWatchlistSearch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WatchlistExplorer } from '../components/WatchlistExplorer';
import { Bell, BriefcaseMedical } from 'lucide-react';
import apiClient from '../api/client';
import type { Alert, AlertListResponse } from '../api/types';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { WatchRemovalReview, type WatchRemovalSelection } from '../components/WatchRemovalReview';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { checkedRemovalRows, checkedWatchMembership, checkedWatchRecord, checkedUnwatchResult, watchKey, watchPath } from '../utils/watchRemovalReview';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones, alertStatusTones, caseStatusTones } from '../components/ui/tones';

interface WatchCase {
  id: number;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  due_date: string | null;
}

interface CaseListResponse {
  cases: WatchCase[];
  total: number;
  page: number;
  pages: number;
}

interface WatchRow {
  kind: 'alert' | 'case';
  id: number;
  name: string;
  detail: string | null;
  severity: string;
  status: string;
  created_at: string;
  due_date: string | null;
  href: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const DONE_STATUSES = ['resolved', 'closed', 'false_positive'];

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 5;
}

export function Watchlist() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [exploring, setExploring] = useState(false);
  const linkedExplorer = ['explore', 'query', 'kind', 'severity', 'scope', 'sort'].some(key => searchParams.has(key));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [scope, setScope] = useState('all');
  const [order, setOrder] = useState('severity');
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState(2);
  const [pagesChanged, setPagesChanged] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<WatchRemovalSelection | null>(null);
  const reviewPending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState('');
  const [failures, setFailures] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const today = new Date().toISOString().slice(0, 10);

  const fetchWatchlist = useCallback(async (page = 1) => {
    if (page === 1) { setLoading(true); setError(null); }
    else setLoadingMore(true);
    setMoreError('');
    try {
      const [alertsRes, casesRes] = await Promise.all([
        apiClient.get<AlertListResponse>('/alerts/', { params: { watching: 'me', size: 50, page } }),
        apiClient.get<CaseListResponse>('/cases/', { params: { watching: 'me', size: 50, page } }),
      ]);
      const alertRows: WatchRow[] = alertsRes.data.alerts.map((a: Alert) => ({
        kind: 'alert',
        id: a.id,
        name: a.cve_id ? `${a.cve_id} - ${a.title}` : a.title,
        detail: a.asset_name ?? null,
        severity: a.severity,
        status: a.status,
        created_at: a.created_at,
        due_date: null,
        href: `/alerts?alert=${a.id}`,
      }));
      const caseRows: WatchRow[] = casesRes.data.cases.map((c) => ({
        kind: 'case',
        id: c.id,
        name: c.title,
        detail: null,
        severity: c.severity,
        status: c.status,
        created_at: c.created_at,
        due_date: c.due_date,
        href: `/cases/${c.id}`,
      }));
      const incoming = [...alertRows, ...caseRows];
      setHasMore(alertsRes.data.total > page * 50 || casesRes.data.total > page * 50);
      setNextPage(page + 1);
      if (page === 1) { setPagesChanged(false); setSelectedKeys(new Set()); setFailures({}); setBulkNotice(''); }
      setRows(current => {
        const unique = new Map((page === 1 ? incoming : [...current, ...incoming]).map(row => [`${row.kind}-${row.id}`, row]));
        return [...unique.values()].sort((a, b) =>
        severityRank(a.severity) - severityRank(b.severity)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      });
    } catch (err: unknown) {
      if (page === 1) setError(getApiErrorMessage(err, 'Your watchlist could not be loaded.'));
      else setMoreError(getApiErrorMessage(err, 'More watched items could not be loaded. Existing items are kept. Try again.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void fetchWatchlist();
  }, [fetchWatchlist]);

  const isOverdue = (row: WatchRow) =>
    !!row.due_date && row.due_date < today && !DONE_STATUSES.includes(row.status);

  const needle = query.trim().toLowerCase();
  const visible = rows.filter(row => (!needle || [row.name, row.detail, String(row.id)].some(value => value?.toLowerCase().includes(needle)))
    && (kind === 'all' || row.kind === kind) && (severity === 'all' || row.severity === severity)
    && (scope === 'all' || (scope === 'overdue' ? isOverdue(row) : scope === 'open' ? !DONE_STATUSES.includes(row.status) : DONE_STATUSES.includes(row.status))));
  if (order !== 'severity') visible.sort((a, b) => {
    if (order === 'name') return a.name.localeCompare(b.name) || a.id - b.id;
    const time = (row: WatchRow) => Number.isFinite(Date.parse(row.created_at)) ? Date.parse(row.created_at) : 0;
    return (order === 'newest' ? time(b) - time(a) : time(a) - time(b)) || a.id - b.id;
  });
  const activeFilters = !!query || kind !== 'all' || severity !== 'all' || scope !== 'all' || order !== 'severity';
  const fullSearch = loadedWatchlistSearch({ query, kind, severity, scope, order });
  const clearFilters = () => { setQuery(''); setKind('all'); setSeverity('all'); setScope('all'); setOrder('severity'); };

  const selectedRows = rows.filter(row => selectedKeys.has(watchKey(row)));
  const hiddenSelected = selectedRows.filter(row => !visible.some(item => watchKey(item) === watchKey(row))).length;
  const stageRemoval = async (chosen: WatchRow[]) => {
    if (pagesChanged || loading || loadingMore || bulkBusy || reviewPending.current || pending.current.size || !chosen.length) return;
    reviewPending.current = true; setBulkBusy(true); setBulkNotice('');
    try {
      const frozenRows = checkedRemovalRows(chosen);
      const account = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (mounted.current) setReview({ rows: frozenRows, hidden: chosen.filter(row => !visible.some(item => watchKey(item) === watchKey(row))).length, account });
    } catch { if (mounted.current) { setPagesChanged(true); setBulkNotice('The current account could not be verified. No unwatch request was sent. Reload watched items before another review.'); } }
    finally { reviewPending.current = false; if (mounted.current) setBulkBusy(false); }
  };
  const confirmRemoval = async () => {
    if (!review || pagesChanged || bulkBusy || reviewPending.current || pending.current.size) return;
    reviewPending.current = true; setBulkBusy(true); setBulkNotice('');
    const frozen = review, removed = new Set<string>(); let sent = false, failure = '';
    frozen.rows.forEach(row => pending.current.add(watchKey(row))); setPendingKeys(new Set(pending.current));
    try {
      const account = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (!mounted.current) return;
      if (JSON.stringify(account) !== JSON.stringify(frozen.account)) throw Error('Current account changed.');
      // Verify every selected record before sending any removal. The existing delete is not CAS.
      for (const row of frozen.rows) {
        const [record, watchers] = await Promise.all([apiClient.get(watchPath(row)), apiClient.get(watchPath(row) + '/watchers')]);
        if (!mounted.current) return;
        checkedWatchRecord(row, record.data); checkedWatchMembership(watchers.data, account.id);
      }
      for (const row of frozen.rows) {
        if (!mounted.current) return;
        sent = true;
        const response = await apiClient.delete(watchPath(row) + '/watch');
        if (!mounted.current) return;
        checkedUnwatchResult(response.status, response.data); removed.add(watchKey(row));
      }
    } catch { failure = sent ? 'A removal outcome is unknown and may already have applied. Processing stopped; later records were not sent. No automatic retry was sent.' : 'The current account, exact record state or watch membership could not be reverified. No unwatch mutation was sent.'; }
    finally {
      reviewPending.current = false; frozen.rows.forEach(row => pending.current.delete(watchKey(row)));
      if (mounted.current) {
        setRows(current => current.filter(row => !removed.has(watchKey(row))));
        setSelectedKeys(current => new Set([...current].filter(key => !removed.has(key))));
        setFailures(failure ? { review: failure } : {}); setBulkNotice(`Verified ${removed.size} of ${frozen.rows.length} reviewed removals. ${failure || 'Only your watch subscriptions were removed. No records were deleted or closed.'} Reload watched items before another edit.`);
        setPagesChanged(true); setPendingKeys(new Set(pending.current)); setBulkBusy(false); setReview(null);
      }
    }
  };

  if (exploring || linkedExplorer) return <div className="min-w-0 space-y-6"><PageHeader eyebrow="Command" title="Watchlist" description="Full-watchlist search across alerts and investigations you follow." /><button type="button" className="rounded border border-surface-600 px-3 py-2 text-sm text-surface-200" onClick={() => { setExploring(false); setSearchParams(current => { const next = new URLSearchParams(current); for (const key of ['explore', 'query', 'kind', 'severity', 'scope', 'sort']) next.delete(key); return next; }, { replace: true }); }}>Back to loaded watchlist review</button><WatchlistExplorer /></div>;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Command"
        title="Watchlist"
        description="Alerts and investigations you follow, ranked by severity within the loaded items. Load more to review larger watchlists."
      />

      <div className="space-y-2 rounded border border-primary-500/30 p-4"><p className="text-sm text-surface-300">Need a record beyond the loaded review list? Search all followed alerts and investigations with server-side filtering, ranking and due-date review.</p><button type="button" disabled={bulkBusy || !!review || !!pendingKeys.size} onClick={() => setExploring(true)} className="rounded border border-surface-600 px-3 py-2 text-sm text-primary-300 disabled:opacity-40">Search entire watchlist</button></div>

      {pagesChanged && <div className="space-y-2 rounded border border-warning/40 p-3 text-xs text-surface-300"><p>Unwatching can move later pages. Reload from the first page before loading more so records are not skipped. Reloading discards kept selection and resets the loaded review list.</p><button type="button" disabled={loading || bulkBusy || !!review || !!pendingKeys.size} onClick={() => { setBulkNotice(''); setFailures({}); void fetchWatchlist(); }} className="rounded border border-surface-600 px-3 py-2 disabled:opacity-40">Reload watched items from first page</button></div>}
      {loading && <LoadingSurface label="Loading your watchlist" />}

      {!loading && error && (
        <ErrorState
          title="Watchlist unavailable"
          description={error}
          action={<RetryButton onClick={() => void fetchWatchlist()} />}
        />
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nothing on your watchlist"
          description="Watch an alert or an investigation and it will show up here, wherever it sits in the org."
        />
      )}

      {!loading && !error && rows.length > 0 && <section aria-label="Watchlist triage" className="space-y-3 rounded-lg border border-surface-700 p-4">
        <label htmlFor="watchlist-search" className="block text-sm font-medium text-surface-200">Find watched items</label>
        <input id="watchlist-search" type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={bulkBusy || !!review} placeholder="Title, CVE, asset or record ID" className="min-h-10 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100" />
        <div className="flex flex-wrap gap-2">
          <select disabled={bulkBusy || !!review} aria-label="Watched item type" value={kind} onChange={event => setKind(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="all">All types</option><option value="alert">Alerts</option><option value="case">Investigations</option></select>
          <select disabled={bulkBusy || !!review} aria-label="Watched severity" value={severity} onChange={event => setSeverity(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="all">All severities</option>{Object.keys(SEVERITY_RANK).map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select disabled={bulkBusy || !!review} aria-label="Watched work scope" value={scope} onChange={event => setScope(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="all">All statuses</option><option value="open">Active records</option><option value="done">Resolved / closed / false positive</option><option value="overdue">Overdue investigations</option></select>
          <select disabled={bulkBusy || !!review} aria-label="Watched item order" value={order} onChange={event => setOrder(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-sm text-surface-200"><option value="severity">Severity first</option><option value="newest">Newest created first</option><option value="oldest">Oldest created first</option><option value="name">Name A to Z</option></select>
          {activeFilters && <button type="button" disabled={bulkBusy || !!review} onClick={clearFilters} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-200">Clear watchlist filters</button>}
        </div>
        <p role="status" className="text-xs text-surface-300">{visible.length} of {rows.length} loaded items match. Search, filters and order apply only to loaded records, not your entire watchlist.</p>
        <div className="space-y-2 rounded border border-primary-500/30 p-3"><button type="button" disabled={bulkBusy || !!review || !!pendingKeys.size || loadingMore || !fullSearch} onClick={() => { if (fullSearch) setSearchParams(fullSearch); }} className="min-h-11 rounded border border-surface-600 px-3 py-2 text-sm text-primary-300 disabled:opacity-40">Search entire watchlist with these filters</button><p className="text-xs text-surface-400">Starts a current server search from page 1 using these keywords, record type, severity, work scope and order. Searches titles, CVEs, assets and IDs, so results can differ from loaded name matching. No selected records, pagination or unwatch action is carried over. Your loaded selection stays here for review on return.</p>{scope === 'overdue' && <p className="text-xs text-warning">Loaded overdue means investigations only. The full search keeps that investigation-only scope, not alert due dates.{kind === 'alert' ? ' Alerts with investigation-only overdue is incompatible. Choose Investigations or All types before opening the full search.' : ''}</p>}{query.trim().length > 200 && <p className="text-xs text-warning">Full-watchlist search accepts at most 200 keyword characters. Shorten this query before opening it. No keywords were truncated.</p>}</div>
        {scope === 'overdue' && <p className="text-xs text-surface-400">Overdue uses investigation due dates before today in UTC, excluding resolved, closed and false-positive records. Alert due dates are not included.</p>}
      </section>}
      {!loading && !error && rows.length > 0 && <section aria-label="Watchlist selection" className="space-y-3 rounded-lg border border-surface-700 p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pagesChanged || !!review || bulkBusy || loadingMore || !!pendingKeys.size || !visible.length} onClick={() => setSelectedKeys(current => new Set([...current, ...visible.map(row => `${row.kind}-${row.id}`)]))} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Select matching watched items</button>
          <button type="button" disabled={!!review || bulkBusy || !selectedRows.length} onClick={() => setSelectedKeys(new Set())} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Clear watchlist selection</button>
        </div>
        <p className="text-xs text-surface-300">{selectedRows.length} loaded records selected; {hiddenSelected} hidden by filters. Unwatching stops following these records, without deleting or closing them.</p>
        {!!selectedRows.length && <>
          <ul aria-label="Selected watched items" tabIndex={0} className="max-h-48 space-y-2 overflow-y-auto text-xs text-surface-300">{selectedRows.map(row => <li key={`${row.kind}-${row.id}`} className="break-words">{row.kind === 'alert' ? 'Alert' : 'Investigation'} #{row.id}: {row.name}{failures[`${row.kind}-${row.id}`] && <p role="alert" className="mt-1 text-danger">{failures[`${row.kind}-${row.id}`]}</p>}</li>)}</ul>
          <button type="button" disabled={pagesChanged || !!review || bulkBusy || loadingMore || !!pendingKeys.size} onClick={() => void stageRemoval(selectedRows)} className="rounded border border-warning/50 px-3 py-2 text-sm text-warning disabled:opacity-40">Review selected unwatch</button>
        </>}
      </section>}
      {bulkNotice && <p role={Object.keys(failures).length ? 'alert' : 'status'} className="rounded border border-surface-600 p-3 text-sm text-surface-200">{bulkNotice}</p>}
      {!loading && !error && rows.length > 0 && visible.length === 0 && <p className="text-sm text-surface-400">No loaded items match. Clear filters or load more watched items to widen the review.</p>}
      {!loading && !error && <p role="status" className="text-sm text-surface-400">{rows.length} watched items loaded. {hasMore ? 'More watched records are available. Ranking applies only to loaded items.' : 'No more pages were reported by this load.'}</p>}
      {!loading && !error && visible.length > 0 && (
        <div className="relative max-w-full overflow-x-auto rounded-lg border border-surface-700">
          <p className="px-4 py-2 text-xs text-surface-500 sm:hidden">Scroll the table horizontally for dates and Unwatch controls.</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-surface-700 bg-surface-800/60 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-400">
                <th className="px-4 py-3"><span className="sr-only">Select</span></th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Since</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="border-b border-surface-800 transition-colors last:border-0 hover:bg-surface-800/50"
                >
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${row.kind} #${row.id}: ${row.name}`} checked={selectedKeys.has(`${row.kind}-${row.id}`)} disabled={pagesChanged || !!review || bulkBusy || loadingMore || pendingKeys.has(`${row.kind}-${row.id}`)} onChange={event => setSelectedKeys(current => { const next = new Set(current); if (event.target.checked) next.add(`${row.kind}-${row.id}`); else next.delete(`${row.kind}-${row.id}`); return next; })} /></td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-300">
                      {row.kind === 'alert'
                        ? <><Bell className="h-3.5 w-3.5 text-primary-300" />Alert</>
                        : <><BriefcaseMedical className="h-3.5 w-3.5 text-primary-300" />Investigation</>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={row.href} className="font-medium text-surface-100 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-400">{row.name}</Link>
                    {row.detail && <span className="ml-2 text-xs text-surface-500">{row.detail}</span>}
                    {isOverdue(row) && (
                      <span className="ml-2 text-xs font-semibold text-danger">Due {row.due_date} (overdue)</span>
                    )}
                    {!isOverdue(row) && row.due_date && (
                      <span className="ml-2 text-xs text-surface-500">Due {row.due_date}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={alertSeverityTones[row.severity] ?? 'neutral'}>{row.severity}</StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={(row.kind === 'alert' ? alertStatusTones : caseStatusTones)[row.status] ?? 'neutral'}>
                      {row.status.replace('_', ' ')}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-surface-400">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); void stageRemoval([row]); }}
                      disabled={pagesChanged || !!review || bulkBusy || loadingMore || pendingKeys.has(`${row.kind}-${row.id}`)}
                      aria-label={`Unwatch ${row.name}`}
                      className="rounded-md border border-surface-600 px-2.5 py-1 text-xs font-medium text-surface-300 hover:border-primary-500/50 hover:text-surface-100 disabled:opacity-50"
                    >
                      Unwatch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review && <WatchRemovalReview review={review} busy={bulkBusy} onCancel={() => { if (!bulkBusy) setReview(null); }} onConfirm={() => void confirmRemoval()} />}
      {!loading && !error && hasMore && <div className="space-y-2">
        {moreError && <p role="alert" className="text-sm text-danger">{moreError}</p>}
        <button type="button" disabled={!!review || bulkBusy || pagesChanged || loadingMore || pendingKeys.size > 0} onClick={() => void fetchWatchlist(nextPage)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200 disabled:opacity-40">{loadingMore ? 'Loading more watched items...' : 'Load more watched items'}</button>
        <p className="text-xs text-surface-500">The list is fetched in pages, not as an atomic snapshot. Records can change while you review it.</p>
      </div>}
    </div>
  );
}
