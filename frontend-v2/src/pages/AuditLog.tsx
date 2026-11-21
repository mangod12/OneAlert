import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { Bot, Download, Search } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { AgentRunInspector } from '../components/AgentRunInspector';
import { useDialogFocus } from '../components/ui/useDialogFocus';

interface AuditEntry {
  id: number;
  user_id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  timestamp: string | null;
}

interface AgentRun {
  id: number;
  agent_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  model_used: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  result_summary: string | null;
}

const runStatusTones: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
  running: 'neutral',
};

export function AuditLog() {
  const logRequest = useRef(0), exportRequest = useRef(0), exportBusy = useRef(false);
  const [selectedRecord, setSelectedRecord] = useState<AuditEntry | null>(null);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [agentRuns, setAgentRuns] = useState<AgentRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState('');
  const [agentRetry, setAgentRetry] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const exportCsv = async () => {
    if (exportBusy.current) return;
    const read = ++exportRequest.current; exportBusy.current = true;
    setExporting(true);
    setExportError('');
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.action = search.trim();
      if (userFilter.trim()) params.user = userFilter.trim();
      if (fromDate) params.from_date = `${fromDate}T00:00:00`;
      if (toDate) params.to_date = `${toDate}T23:59:59`;
      const res = await apiClient.get('/auth/audit-logs/export', { params, responseType: 'blob' });
      if (read !== exportRequest.current) return;
      if (!(res.data instanceof Blob) || !res.data.type.startsWith('text/csv')) throw new Error('The server did not return an audit CSV. No file was downloaded.');
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-logs.csv';
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
    } catch (err: unknown) {
      if (read !== exportRequest.current) return;
      const response = (err as { response?: { data?: unknown } } | null)?.response;
      if (response?.data instanceof Blob) {
        try { response.data = JSON.parse(await response.data.text()); } catch { /* Use the normal fallback. */ }
      }
      if (read === exportRequest.current) setExportError(getApiErrorMessage(err, 'The export could not be downloaded. No file was downloaded.'));
    } finally {
      if (read === exportRequest.current) { exportBusy.current = false; setExporting(false); }
    }
  };
  useEffect(() => {
    exportRequest.current += 1; exportBusy.current = false; setExporting(false); setExportError('');
    return () => { exportRequest.current += 1; };
  }, [search, userFilter, fromDate, toDate]);
  const SIZE = 50;
  const pages = Math.max(1, Math.ceil(total / SIZE));

  const fetchLogs = useCallback(async (targetPage: number, action: string, user: string, from: string, to: string) => {
    const request = ++logRequest.current;
    setLoading(true); setLogs([]); setTotal(0); setError('');
    try {
      const params: Record<string, string | number> = { page: targetPage, size: SIZE };
      if (action.trim()) params.action = action.trim();
      if (user.trim()) params.user = user.trim();
      if (from) params.from_date = `${from}T00:00:00`;
      if (to) params.to_date = `${to}T23:59:59`;
      const res = await apiClient.get('/auth/audit-logs', { params });
      if (request !== logRequest.current) return;
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch (err: unknown) {
      if (request === logRequest.current) setError(getApiErrorMessage(err, 'Audit activity could not be loaded.'));
    } finally {
      if (request === logRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(page, search, userFilter, fromDate, toDate);
    return () => { logRequest.current += 1; };
  }, [page, search, userFilter, fromDate, toDate, fetchLogs]);

  useEffect(() => {
    let active = true;
    setAgentLoading(true);
    setAgentError('');
    void apiClient.get<AgentRun[]>('/cases/agents/runs').then(response => {
      if (active) setAgentRuns(response.data);
    }).catch(err => {
      if (active) setAgentError(getApiErrorMessage(err, 'Recorded agent activity could not be loaded.'));
    }).finally(() => { if (active) setAgentLoading(false); });
    return () => { active = false; };
  }, [agentRetry]);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader eyebrow="Govern" title="Audit Log" description="Immutable operator, agent, approval, and configuration activity." />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-52">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
              <input
                type="text"
                aria-label="Search audit actions"
                placeholder="Search actions..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              type="text"
              aria-label="Filter by user email"
              placeholder="User email..."
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
              className="w-44 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={() => { void exportCsv(); }}
              disabled={exporting}
              className="flex items-center gap-2 px-3 py-2 bg-surface-800 hover:bg-surface-700 border border-surface-600 rounded-lg text-sm text-surface-200 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
          <p className="text-xs text-surface-400">CSV includes every matching entry across audit pages, up to 5,000 entries. Larger exports are refused without a partial file. Narrow the action, user or date filters if needed. Changing filters cancels a pending download. The export is a new current read, not a frozen copy of this page.</p>
          {exportError && <p role="alert" className="text-sm text-danger-400">{exportError}</p>}

      {loading ? <LoadingSurface rows={6} label="Loading audit activity" /> : error ? (
        <ErrorState title="Audit log unavailable" description={error} action={<RetryButton onClick={() => void fetchLogs(page, search, userFilter, fromDate, toDate)} />} />
      ) : (
          <div role="region" aria-label="Audit activity records" tabIndex={0} className="oa-panel relative overflow-x-auto rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-400">
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                  <th className="px-4 py-3 text-right">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                      No audit log entries found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                      <td className="px-4 py-3 text-surface-400 text-xs">
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-surface-200 font-medium">{log.action}</td>
                      <td className="px-4 py-3 text-surface-400">
                        {log.target_type ? `${log.target_type} #${log.target_id}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-surface-500 text-xs max-w-xs truncate">
                        {log.detail || '-'}
                      </td>
                      <td className="px-4 py-3 text-right"><button type="button" aria-label={`Inspect audit record ${log.id}`} onClick={() => setSelectedRecord(log)} className="whitespace-nowrap rounded border border-surface-600 px-2.5 py-1.5 text-xs text-primary-300 hover:border-primary-500">Inspect record</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {total > 0 && (
              <div className="flex items-center justify-between border-t border-surface-700 px-4 py-3">
                <span className="text-xs text-surface-500">{total} entries</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-300 hover:bg-surface-800 disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-surface-400">Page {page} of {pages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-300 hover:bg-surface-800 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

      )}
      {selectedRecord && <AuditRecordDialog record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
      <section aria-label="Recorded agent activity" className="space-y-3">
        <p className="text-sm text-surface-400">Your latest 50 recorded agent runs. Inspect a run for its saved step summaries. This ledger is not a full execution transcript.</p>
        {agentLoading && <p role="status" className="text-sm text-surface-400">Loading recorded agent activity...</p>}
        {!agentLoading && agentError && <ErrorState title="Agent activity unavailable" description={agentError} action={<RetryButton onClick={() => setAgentRetry(value => value + 1)} />} />}
        {!agentLoading && !agentError && agentRuns?.length === 0 && <p className="text-sm text-surface-400">No agent runs recorded for your account.</p>}
        {!agentLoading && !agentError && agentRuns && agentRuns.length > 0 && (
            <div className="oa-panel relative overflow-x-auto rounded-md">
              <h2 className="flex items-center gap-2 border-b border-surface-700 px-4 py-3 text-sm font-semibold text-surface-50">
                <Bot className="w-4 h-4 text-primary-400" aria-hidden="true" />
                Agent activity
              </h2>
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-surface-700 text-surface-400">
                    <th className="px-4 py-3 text-left">Started</th>
                    <th className="px-4 py-3 text-left">Agent</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Model</th>
                    <th className="px-4 py-3 text-left">Tokens</th>
                    <th className="px-4 py-3 text-left">Result</th>
                    <th className="px-4 py-3 text-left">Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRuns.map((run) => (
                    <tr key={run.id} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                      <td className="px-4 py-3 text-surface-400 text-xs">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-surface-200 font-medium capitalize">{run.agent_type}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={runStatusTones[run.status] ?? 'neutral'}>{run.status}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-surface-400 text-xs">{run.model_used ?? '-'}</td>
                      <td className="px-4 py-3 text-surface-400 text-xs">
                        {(run.prompt_tokens + run.completion_tokens).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-surface-500 text-xs max-w-xs truncate">
                        {run.result_summary || '-'}
                      </td>
                      <td className="px-4 py-3"><button type="button" onClick={() => setSelectedRunId(run.id)} aria-label={`Inspect ${run.agent_type} run ${run.id}`} className="rounded-md border border-surface-600 px-3 py-1.5 text-xs text-primary-300">Inspect run</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      {selectedRunId !== null && <AgentRunInspector key={selectedRunId} runId={selectedRunId} onClose={() => setSelectedRunId(null)} />}
    </div>
  );
}

function AuditRecordDialog({ record, onClose }: { record: AuditEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const fields = [['Record ID', String(record.id)], ['Actor user ID', String(record.user_id)], ['Action', record.action], ['Target type', record.target_type], ['Target ID', record.target_id], ['Recorded timestamp', record.timestamp]];
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="audit-record-title" className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-5 shadow-[var(--oa-shadow-float)]">
      <div className="flex items-start justify-between gap-4"><h2 id="audit-record-title" className="text-lg font-semibold text-surface-50">Audit record #{record.id}</h2><button type="button" onClick={onClose} className="rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200">Close record</button></div>
      <p className="my-3 text-xs text-surface-400">Read-only evidence from the loaded audit record. Actor IDs are recorded user IDs, not verified names. Missing fields are not reconstructed.</p>
      <dl className="divide-y divide-surface-700">{fields.map(([label, value]) => <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"><dt className="text-xs text-surface-400">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-surface-100 [overflow-wrap:anywhere]">{value != null && String(value).trim() ? String(value) : 'Not recorded'}</dd></div>)}</dl>
      <h3 className="mb-2 mt-4 text-xs font-semibold text-surface-300">Full recorded detail</h3>
      <pre className="max-w-full whitespace-pre-wrap break-words rounded border border-surface-700 bg-surface-950 p-3 text-xs text-surface-200 [overflow-wrap:anywhere]">{record.detail?.trim() ? record.detail : 'Not recorded'}</pre>
    </div>
  </div>;
}
