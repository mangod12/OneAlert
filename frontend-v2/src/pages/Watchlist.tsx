import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const today = new Date().toISOString().slice(0, 10);

  const fetchWatchlist = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [alertsRes, casesRes] = await Promise.all([
        apiClient.get<AlertListResponse>('/alerts/', { params: { watching: 'me', size: 50 } }),
        apiClient.get<CaseListResponse>('/cases/', { params: { watching: 'me', size: 50 } }),
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
      const merged = [...alertRows, ...caseRows].sort((a, b) =>
        severityRank(a.severity) - severityRank(b.severity)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setRows(merged);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Your watchlist could not be loaded.'));
    } finally {
      setLoading(false);
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command"
        title="Watchlist"
        description="Every alert and investigation you follow, in one place, ranked by severity."
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

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-surface-700">
          <table className="w-full text-sm">
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
                  onClick={() => navigate(row.href)}
                  className="cursor-pointer border-b border-surface-800 transition-colors last:border-0 hover:bg-surface-800/50"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-300">
                      {row.kind === 'alert'
                        ? <><Bell className="h-3.5 w-3.5 text-primary-300" />Alert</>
                        : <><BriefcaseMedical className="h-3.5 w-3.5 text-primary-300" />Investigation</>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-surface-100">{row.name}</span>
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
                      disabled={pendingKeys.has(`${row.kind}-${row.id}`)}
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
    </div>
  );
}
