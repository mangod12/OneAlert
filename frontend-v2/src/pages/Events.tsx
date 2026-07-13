import { useCallback, useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Activity } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';

const severityColors: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  info: 'text-surface-500',
};

interface SecurityEvent {
  id: number;
  timestamp: string;
  event_type: string;
  severity: string;
  source_ip: string | null;
  source_port: number | null;
  dest_ip: string | null;
  dest_port: number | null;
  protocol: string | null;
  signature: string | null;
  category: string | null;
  source_type: string | null;
}

interface EventStats {
  total_events: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  source_count: number;
}

export function Events() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [severityFilter, setSeverityFilter] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const params: Record<string, string | number> = { page, size: 50 };
      if (severityFilter) params.severity = severityFilter;
      const [evtResult, statsResult] = await Promise.allSettled([
        apiClient.get('/events/', { params }),
        apiClient.get('/events/stats'),
      ]);
      const nextErrors: string[] = [];
      if (evtResult.status === 'fulfilled') { setEvents(evtResult.value.data.events); setTotal(evtResult.value.data.total); }
      else nextErrors.push(getApiErrorMessage(evtResult.reason, 'Event stream is unavailable'));
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data.data);
      else nextErrors.push(getApiErrorMessage(statsResult.reason, 'Event statistics are unavailable'));
      setErrors(nextErrors);
    } catch (err: unknown) {
      setErrors([getApiErrorMessage(err, 'Security events could not be loaded.')]);
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Security Events" description={`${total} events${stats ? ` from ${stats.source_count} telemetry sources` : ''}.`} />

      {errors.length > 0 && (events.length > 0 || stats) && <DegradedBanner messages={errors} onRetry={() => void fetchEvents()} />}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {['critical', 'high', 'medium', 'low', 'info'].map(sev => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(severityFilter === sev ? '' : sev)}
              className={clsx(
                'bg-surface-800/50 border rounded-xl p-4 text-left transition-colors',
                severityFilter === sev ? 'border-primary-500' : 'border-surface-700 hover:border-surface-600',
              )}
            >
              <p className={clsx('text-xs uppercase', severityColors[sev])}>{sev}</p>
              <p className="text-xl font-bold text-white mt-1">{stats.by_severity[sev] || 0}</p>
            </button>
          ))}
        </div>
      )}

      {/* Event Table */}
      {loading ? (
        <LoadingSurface rows={5} label="Loading security events" />
      ) : errors.length > 0 && events.length === 0 ? (
        <ErrorState title="Event stream unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchEvents()} />} />
      ) : events.length === 0 ? (
        <div className="text-center py-20">
          <Activity className="w-16 h-16 text-surface-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-surface-300">No events ingested yet</h3>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Upload Suricata EVE JSON or Zeek logs, or configure a webhook receiver for real-time ingestion.
          </p>
        </div>
      ) : (
        <div className="oa-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left p-3 text-surface-400 font-medium">Time</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Severity</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Type</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Source</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Destination</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Signature</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="p-3 text-surface-400 whitespace-nowrap text-xs">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="p-3">
                      <span className={clsx('text-xs font-medium', severityColors[e.severity])}>{e.severity}</span>
                    </td>
                    <td className="p-3 text-surface-300">{e.event_type}</td>
                    <td className="p-3 text-surface-300 font-mono text-xs">
                      {e.source_ip}{e.source_port ? `:${e.source_port}` : ''}
                    </td>
                    <td className="p-3 text-surface-300 font-mono text-xs">
                      {e.dest_ip}{e.dest_port ? `:${e.dest_port}` : ''}
                    </td>
                    <td className="p-3 text-surface-300 truncate max-w-xs">{e.signature || e.category || '—'}</td>
                    <td className="p-3 text-surface-500 text-xs">{e.source_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between p-3 border-t border-surface-700">
            <span className="text-xs text-surface-500">Page {page} of {Math.ceil(total / 50)}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                className="px-3 py-1 text-xs bg-surface-700 text-surface-300 rounded disabled:opacity-30">Prev</button>
              <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1 text-xs bg-surface-700 text-surface-300 rounded disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
