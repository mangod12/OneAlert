import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { ClipboardList, Search } from 'lucide-react';

interface AuditEntry {
  id: number;
  user_id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  timestamp: string | null;
}

export function AuditLog() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await apiClient.get('/auth/audit-logs');
        setLogs(res.data);
      } catch (err: any) {
        if (err.response?.status === 403) {
          setError('Admin access required to view audit logs.');
        } else {
          setError('Failed to load audit logs.');
        }
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter((log) =>
    !search || log.action.toLowerCase().includes(search.toLowerCase()) ||
    log.detail?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-surface-400 mt-1">Track all user actions</p>
      </div>

      {error ? (
        <div className="p-6 bg-surface-800/50 border border-surface-700 rounded-xl text-center">
          <ClipboardList className="w-8 h-8 mx-auto mb-3 text-surface-500" />
          <p className="text-surface-400">{error}</p>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
            <input
              type="text"
              placeholder="Search actions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="bg-surface-800/50 border border-surface-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-400">
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-surface-500">
                      No audit log entries found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
