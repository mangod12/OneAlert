import { useCallback, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Activity, Radio, Upload } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/Toast';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { StatusBadge } from '../components/ui/StatusBadge';
import { eventSeverityTones } from '../components/ui/tones';

const severityColors: Record<string, string> = {
  critical: 'text-danger',
  high: 'text-warning',
  medium: 'text-warning',
  low: 'text-info',
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

interface EventSource {
  id: number;
  name: string;
  source_type: string;
  status: string;
  event_count: number;
  last_event_at: string | null;
  created_at: string;
}

export function Events() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [severityFilter, setSeverityFilter] = useState('');
  const [sort, setSort] = useState('timestamp_desc');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [ipSearch, setIpSearch] = useState('');
  const [signatureSearch, setSignatureSearch] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [sources, setSources] = useState<EventSource[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [escalateEvent, setEscalateEvent] = useState<SecurityEvent | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const params: Record<string, string | number> = { page, size: 50 };
      if (severityFilter) params.severity = severityFilter;
      if (eventTypeFilter) params.event_type = eventTypeFilter;
      if (ipSearch.trim()) params.ip = ipSearch.trim();
      if (signatureSearch.trim()) params.signature = signatureSearch.trim();
      if (sourceTypeFilter) params.source_type = sourceTypeFilter;
      params.sort = sort;
      const [evtResult, statsResult, sourcesResult] = await Promise.allSettled([
        apiClient.get('/events/', { params }),
        apiClient.get('/events/stats'),
        apiClient.get('/events/sources'),
      ]);
      const nextErrors: string[] = [];
      if (evtResult.status === 'fulfilled') { setEvents(evtResult.value.data.events); setTotal(evtResult.value.data.total); }
      else nextErrors.push(getApiErrorMessage(evtResult.reason, 'Event stream is unavailable'));
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data.data);
      else nextErrors.push(getApiErrorMessage(statsResult.reason, 'Event statistics are unavailable'));
      if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value.data);
      setErrors(nextErrors);
    } catch (err: unknown) {
      setErrors([getApiErrorMessage(err, 'Security events could not be loaded.')]);
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, eventTypeFilter, ipSearch, signatureSearch, sourceTypeFilter, sort]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  useEffect(() => {
    apiClient.get('/events/types').then(res => setEventTypes(res.data.types ?? [])).catch(() => {});
  }, []);

  const handleUpload = async (file: File, sourceType: string) => {
    if (uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post('/events/upload', form, {
        params: { source_type: sourceType },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = res.data?.data ?? {};
      const ingested = result.ingested ?? 0;
      const skipped = result.skipped ?? 0;
      toast(`Ingested ${ingested} event${ingested === 1 ? '' : 's'} from ${file.name}${skipped ? ` (${skipped} skipped)` : ''}.`, 'success');
      setShowUpload(false);
      await fetchEvents();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The file could not be ingested. Use Suricata EVE JSON or Zeek JSON logs.'), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Observe"
        title="Security Events"
        description={`${total} events${stats ? ` from ${stats.source_count} telemetry sources` : ''}.`}
        actions={(
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"
          >
            <Upload className="h-4 w-4" /> Upload events
          </button>
        )}
      />

      {errors.length > 0 && (events.length > 0 || stats) && <DegradedBanner messages={errors} onRetry={() => void fetchEvents()} />}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {['critical', 'high', 'medium', 'low', 'info'].map(sev => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(severityFilter === sev ? '' : sev)}
              aria-pressed={severityFilter === sev}
              className={clsx(
                'oa-panel p-4 text-left transition-colors rounded-md',
                severityFilter === sev ? 'border-primary-500' : 'border-surface-700 hover:border-surface-600',
              )}
            >
              <p className={clsx('text-xs uppercase', severityColors[sev])}>{sev}</p>
              <p className="text-xl font-bold text-surface-50 mt-1">{stats.by_severity[sev] || 0}</p>
            </button>
          ))}
        </div>
      )}

      {/* Telemetry Sources */}
      {sources.length > 0 && (
        <div className="oa-panel p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-100"><Radio className="h-4 w-4 text-primary-300" /> Telemetry sources</h2>
          <ul className="divide-y divide-surface-800">
            {sources.map(source => (
              <li key={source.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-surface-200">{source.name}</p>
                  <p className="text-xs text-surface-500">
                    {source.source_type} · {source.event_count} events · {source.last_event_at ? `last seen ${new Date(source.last_event_at).toLocaleString()}` : 'no events yet'}
                  </p>
                </div>
                <StatusBadge tone={source.status === 'active' ? 'success' : 'neutral'}>{source.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Event filters */}
      <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="event-ip-filter" className="text-xs text-surface-400">IP</label>
        <input
          id="event-ip-filter"
          aria-label="Search by IP address"
          type="text"
          placeholder="Source or destination IP"
          value={ipSearch}
          onChange={e => { setPage(1); setIpSearch(e.target.value); }}
          className="bg-surface-800 border border-surface-700 text-surface-200 text-xs rounded px-2 py-1.5 w-44 placeholder:text-surface-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="event-signature-filter" className="text-xs text-surface-400">Signature</label>
        <input
          id="event-signature-filter"
          aria-label="Search by signature"
          type="text"
          placeholder="Rule or notice name"
          value={signatureSearch}
          onChange={e => { setPage(1); setSignatureSearch(e.target.value); }}
          className="bg-surface-800 border border-surface-700 text-surface-200 text-xs rounded px-2 py-1.5 w-44 placeholder:text-surface-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="event-source-filter" className="text-xs text-surface-400">Sensor</label>
        <select
          id="event-source-filter"
          aria-label="Filter by sensor type"
          value={sourceTypeFilter}
          onChange={e => { setPage(1); setSourceTypeFilter(e.target.value); }}
          className="bg-surface-800 border border-surface-700 text-surface-200 text-xs rounded px-2 py-1.5"
        >
          <option value="">All sensors</option>
          {[...new Set(sources.map(s => s.source_type))].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {eventTypes.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="event-type-filter" className="text-xs text-surface-400">Type</label>
          <select
            id="event-type-filter"
            aria-label="Filter by event type"
            value={eventTypeFilter}
            onChange={e => { setPage(1); setEventTypeFilter(e.target.value); }}
            className="bg-surface-800 border border-surface-700 text-surface-200 text-xs rounded px-2 py-1.5"
          >
            <option value="">All types</option>
            {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="event-sort" className="text-xs text-surface-400">Sort</label>
        <select
          id="event-sort"
          aria-label="Sort events"
          value={sort}
          onChange={e => { setPage(1); setSort(e.target.value); }}
          className="bg-surface-800 border border-surface-700 text-surface-200 text-xs rounded px-2 py-1.5"
        >
          <option value="timestamp_desc">Newest first</option>
          <option value="timestamp_asc">Oldest first</option>
          <option value="severity_desc">Highest severity</option>
          <option value="severity_asc">Lowest severity</option>
        </select>
      </div>
      </div>

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
                  <th className="text-left p-3 text-surface-400 font-medium">Sensor</th>
                  <th className="text-left p-3 text-surface-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="p-3 text-surface-400 whitespace-nowrap text-xs tabular-nums">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="p-3">
                      <StatusBadge tone={eventSeverityTones[e.severity] ?? 'neutral'}>{e.severity}</StatusBadge>
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
                    <td className="p-3">
                      <button
                        type="button"
                        aria-label={`Escalate event ${e.id}`}
                        onClick={() => setEscalateEvent(e)}
                        className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800"
                      >
                        Escalate
                      </button>
                    </td>
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
      {showUpload && (
        <EventUploadDialog
          uploading={uploading}
          onClose={() => { if (!uploading) setShowUpload(false); }}
          onUpload={(file, sourceType) => void handleUpload(file, sourceType)}
        />
      )}
      {escalateEvent && <EventEscalateDialog event={escalateEvent} onCancel={() => setEscalateEvent(null)} />}
    </div>
  );
}

interface EventEscalateDialogProps {
  event: SecurityEvent;
  onCancel: () => void;
}

function EventEscalateDialog({ event, onCancel }: EventEscalateDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, onCancel);
  const navigate = useNavigate();
  const label = event.signature || event.event_type;
  const [title, setTitle] = useState(`Investigate: ${label}`);
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState<string>(event.severity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post('/cases/', { title: title.trim(), summary: summary.trim() || null, severity });
      const caseId: number = res.data.id;
      await apiClient.post(`/cases/${caseId}/events/${event.id}`);
      navigate(`/cases/${caseId}`);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'The investigation could not be opened.'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/70" aria-hidden="true" onClick={() => { if (!busy) onCancel(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escalate-event-dialog-title"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="escalate-event-dialog-title" className="text-lg font-semibold text-surface-50">Open investigation</h2>
        <p className="mt-1 text-sm text-surface-400">Create a case for {label} and link this event to it.</p>
        <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void handleSubmit(); }}>
          <div>
            <label htmlFor="escalate-event-title" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Title</label>
            <input id="escalate-event-title" type="text" autoComplete="off" value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="escalate-event-summary" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Summary</label>
            <textarea id="escalate-event-summary" rows={3} value={summary} onChange={e => setSummary(e.target.value)} placeholder="Optional context for the team" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
          </div>
          <div>
            <label htmlFor="escalate-event-severity" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-400">Severity</label>
            <select id="escalate-event-severity" value={severity} onChange={e => setSeverity(e.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100">
              <option value="info">Info</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{busy ? 'Opening…' : 'Open investigation'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EventUploadDialog({ uploading, onClose, onUpload }: {
  uploading: boolean;
  onClose: () => void;
  onUpload: (file: File, sourceType: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState('suricata');
  const [formError, setFormError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!uploading) onClose(); });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFormError('Choose a file to upload.');
      return;
    }
    setFormError('');
    onUpload(file, sourceType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={() => { if (!uploading) onClose(); }}></div>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="event-upload-title" className="relative w-full max-w-lg rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]">
        <h2 id="event-upload-title" className="mb-1 text-lg font-semibold text-surface-50">Upload events</h2>
        <p className="mb-4 text-xs text-surface-500">Newline-delimited JSON or a JSON array. Up to 50,000 events per file.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="event-upload-file" className="mb-1 block text-sm font-medium text-surface-300">Log file</label>
            <input
              id="event-upload-file"
              type="file"
              accept=".json,.log,.eve,.ndjson,application/json"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-surface-300 file:mr-3 file:rounded-md file:border file:border-surface-600 file:bg-surface-800 file:px-3 file:py-1.5 file:text-xs file:text-surface-200"
            />
          </div>
          <div>
            <label htmlFor="event-upload-type" className="mb-1 block text-sm font-medium text-surface-300">Source type</label>
            <select
              id="event-upload-type"
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="suricata">Suricata (EVE JSON)</option>
              <option value="zeek">Zeek (JSON logs)</option>
            </select>
          </div>
          {formError && <p role="alert" className="text-xs text-danger">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="rounded px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="rounded-md bg-primary-500 px-3.5 py-1.5 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
