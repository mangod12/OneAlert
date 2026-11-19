import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BriefcaseMedical } from 'lucide-react';
import apiClient from '../api/client';
import type { Alert, AlertListResponse } from '../api/types';
import { getApiErrorMessage } from '../api/errors';
import { toast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
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
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState(2);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
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

  const handleUnwatch = async (row: WatchRow) => {
    const key = `${row.kind}-${row.id}`;
    if (pendingKeys.has(key)) return;
    setPendingKeys(current => new Set(current).add(key));
    try {
      await apiClient.delete(row.kind === 'alert' ? `/alerts/${row.id}/watch` : `/cases/${row.id}/watch`);
      setRows(current => current.filter(r => !(r.kind === row.kind && r.id === row.id)));
      toast(`${row.kind === 'alert' ? 'Alert' : 'Investigation'} removed from your watchlist.`, 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The item could not be unwatched.'), 'error');
    } finally {
      setPendingKeys(current => { const next = new Set(current); next.delete(key); return next; });
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Command"
        title="Watchlist"
        description="Alerts and investigations you follow, ranked by severity within the loaded items. Load more to review larger watchlists."
      />

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

      {!loading && !error && <p role="status" className="text-sm text-surface-400">{rows.length} watched items loaded. {hasMore ? 'More watched records are available. Ranking applies only to loaded items.' : 'All records returned by this load are shown.'}</p>}
      {!loading && !error && rows.length > 0 && (
        <div className="relative max-w-full overflow-x-auto rounded-lg border border-surface-700">
          <p className="px-4 py-2 text-xs text-surface-500 sm:hidden">Scroll the table horizontally for dates and Unwatch controls.</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-surface-700 bg-surface-800/60 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-400">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Since</th>
                <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="border-b border-surface-800 transition-colors last:border-0 hover:bg-surface-800/50"
                >
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
                      onClick={(e) => { e.stopPropagation(); void handleUnwatch(row); }}
                      disabled={loadingMore || pendingKeys.has(`${row.kind}-${row.id}`)}
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
      {!loading && !error && hasMore && <div className="space-y-2">
        {moreError && <p role="alert" className="text-sm text-danger">{moreError}</p>}
        <button type="button" disabled={loadingMore || pendingKeys.size > 0} onClick={() => void fetchWatchlist(nextPage)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200 disabled:opacity-40">{loadingMore ? 'Loading more watched items...' : 'Load more watched items'}</button>
        <p className="text-xs text-surface-500">The list is fetched in pages, not as an atomic snapshot. Records can change while you review it.</p>
      </div>}
    </div>
  );
}
