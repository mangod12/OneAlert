import { useEffect, useState, useCallback } from 'react';
import apiClient from '../api/client';
import type { Alert, AlertListResponse } from '../api/types';
import { AlertDetail } from '../components/AlertDetail';
import clsx from 'clsx';
import { Search, Filter, CheckCircle } from 'lucide-react';

const severityColors: Record<string, string> = {
  critical: 'bg-danger/10 text-danger border-danger/20',
  high: 'bg-warning/10 text-warning border-warning/20',
  medium: 'bg-info/10 text-info border-info/20',
  low: 'bg-success/10 text-success border-success/20',
};

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [cveSearch, setCveSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, size: 15 };
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;
      if (cveSearch) params.cve_id = cveSearch;

      const res = await apiClient.get<AlertListResponse>('/alerts/', { params });
      setAlerts(res.data.alerts);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, statusFilter, cveSearch]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId: number) => {
    await apiClient.post(`/alerts/${alertId}/acknowledge`);
    fetchAlerts();
    setSelectedAlert(null);
  };

  const handleBulkAcknowledge = async () => {
    await Promise.all(
      Array.from(selectedIds).map((id) => apiClient.post(`/alerts/${id}/acknowledge`))
    );
    setSelectedIds(new Set());
    fetchAlerts();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-surface-400 mt-1">{total} total alerts</p>
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkAcknowledge}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Acknowledge ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="Search CVE..."
            value={cveSearch}
            onChange={(e) => { setCveSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-400"></div>
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No alerts found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400">
                <th className="px-4 py-3 text-left w-8">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(alerts.map((a) => a.id)));
                      else setSelectedIds(new Set());
                    }}
                    className="rounded border-surface-600"
                  />
                </th>
                <th className="px-4 py-3 text-left">CVE</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  key={alert.id}
                  onClick={() => setSelectedAlert(alert)}
                  className="border-b border-surface-700/50 hover:bg-surface-800 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      className="rounded border-surface-600"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-primary-300">{alert.cve_id}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium border', severityColors[alert.severity])}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-surface-300">{alert.asset_name}</td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      'text-xs',
                      alert.status === 'pending' ? 'text-warning' : 'text-success'
                    )}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-surface-500">
                    {new Date(alert.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-300 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-surface-400">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Detail Panel */}
      {selectedAlert && (
        <AlertDetail
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onAcknowledge={handleAcknowledge}
        />
      )}
    </div>
  );
}
