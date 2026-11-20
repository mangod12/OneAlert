import { Fragment, useCallback, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { Activity, ChevronDown, ChevronRight, Download, Radio, Upload } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/Toast';
import { useDialogFocus } from '../components/ui/useDialogFocus';
import { StatusBadge } from '../components/ui/StatusBadge';
import { SavedViewsMenu } from '../components/SavedViewsMenu';
import { reviewEventFile, type EventFileReview } from '../utils/eventFileReview';
import { EventImportReceipt } from '../components/EventImportReceipt';
import { importResponseMetadata, type ImportReceipt } from '../utils/eventImportReceipt';
import { eventSeverityTones } from '../components/ui/tones';

const utcInput = (value?: string) => value ? new Date(value).toISOString().replace(/Z$/, '').replace(/\.000$/, '').replace(/:00$/, '') : '';

interface EventViewFilters {
  started_at?: string;
  ended_before?: string;
  severity?: string;
  event_type?: string;
  source_type?: string;
  source_id?: number;
  ip?: string;
  signature?: string;
  sort?: string;
}

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
  action?: string | null;
  hostname?: string | null;
  username?: string | null;
  domain?: string | null;
  url?: string | null;
  user_agent?: string | null;
  bytes_in?: number | null;
  bytes_out?: number | null;
  raw_data?: Record<string, unknown> | null;
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
  const eventRequestId = useRef(0);
  const [eventError, setEventError] = useState('');
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
  const [sourceIdFilter, setSourceIdFilter] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [sources, setSources] = useState<EventSource[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [importReceipt, setImportReceipt] = useState<ImportReceipt | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timeWindow, setTimeWindow] = useState<{ started_at?: string; ended_before?: string }>({});
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [timeError, setTimeError] = useState('');
  const timeDirty = startInput !== utcInput(timeWindow.started_at) || endInput !== utcInput(timeWindow.ended_before);
  const applyTimeWindow = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const started_at = startInput ? new Date(`${startInput}Z`).toISOString() : undefined;
      const ended_before = endInput ? new Date(`${endInput}Z`).toISOString() : undefined;
      if (started_at && ended_before && started_at >= ended_before) { setTimeError('Start must be before the exclusive end time.'); return; }
      setTimeError(''); setTimeWindow({ ...(started_at ? { started_at } : {}), ...(ended_before ? { ended_before } : {}) }); setPage(1);
    } catch { setTimeError('Enter valid UTC timestamps.'); }
  };


  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      Object.assign(params, timeWindow);
      if (severityFilter) params.severity = severityFilter;
      if (eventTypeFilter) params.event_type = eventTypeFilter;
      if (sourceTypeFilter) params.source_type = sourceTypeFilter;
      if (sourceIdFilter) params.source_id = sourceIdFilter;
      if (ipSearch.trim()) params.ip = ipSearch.trim();
      if (signatureSearch.trim()) params.signature = signatureSearch.trim();
      const res = await apiClient.get('/events/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'events.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
    }
  };
  const [escalateEvent, setEscalateEvent] = useState<SecurityEvent | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);

  const fetchEvents = useCallback(async () => {
    const request = ++eventRequestId.current;
    setLoading(true); setEventError('');
    setEvents([]); setTotal(0); setExpandedId(null);
    setErrors([]);
    try {
      const params: Record<string, string | number> = { page, size: 50 };
      Object.assign(params, timeWindow);
      if (severityFilter) params.severity = severityFilter;
      if (eventTypeFilter) params.event_type = eventTypeFilter;
      if (ipSearch.trim()) params.ip = ipSearch.trim();
      if (signatureSearch.trim()) params.signature = signatureSearch.trim();
      if (sourceTypeFilter) params.source_type = sourceTypeFilter;
      if (sourceIdFilter) params.source_id = sourceIdFilter;
      params.sort = sort;
      const [evtResult, statsResult, sourcesResult] = await Promise.allSettled([
        apiClient.get('/events/', { params }),
        apiClient.get('/events/stats'),
        apiClient.get('/events/sources'),
      ]);
      if (request !== eventRequestId.current) return;
      const nextErrors: string[] = [];
      if (evtResult.status === 'fulfilled') { setEvents(evtResult.value.data.events); setTotal(evtResult.value.data.total); }
      else setEventError(getApiErrorMessage(evtResult.reason, 'Event stream is unavailable'));
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data.data);
      else { setStats(null); nextErrors.push(getApiErrorMessage(statsResult.reason, 'Event statistics are unavailable')); }
      if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value.data);
      else { setSources([]); nextErrors.push(getApiErrorMessage(sourcesResult.reason, 'Recorded source details are unavailable')); }
      setErrors(nextErrors);
    } catch (err: unknown) {
      if (request === eventRequestId.current) setEventError(getApiErrorMessage(err, 'Security events could not be loaded.'));
    } finally {
      if (request === eventRequestId.current) setLoading(false);
    }
  }, [page, severityFilter, eventTypeFilter, ipSearch, signatureSearch, sourceTypeFilter, sourceIdFilter, sort, timeWindow]);

  useEffect(() => {
    void fetchEvents();
    return () => { eventRequestId.current += 1; };
  }, [fetchEvents]);

  useEffect(() => {
    apiClient.get('/events/types').then(res => setEventTypes(res.data.types ?? [])).catch(() => {});
  }, []);

  const handleUpload = async (file: File, sourceType: string) => {
    if (uploadInFlight.current) return;
    uploadInFlight.current = true;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post('/events/upload', form, {
        params: { source_type: sourceType },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = importResponseMetadata(res.data?.data);
      const ingested = result.ingested ?? 0;
      const skipped = result.skipped ?? 0;
      setImportReceipt({ filename: file.name, parser: sourceType, received_at: new Date().toISOString(), result });
      toast(`Ingested ${ingested} event${ingested === 1 ? '' : 's'} from ${file.name}${skipped ? ` (${skipped} skipped)` : ''}.`, ingested === 0 || skipped > 0 ? 'warning' : 'success');
      setShowUpload(false);
      await fetchEvents();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The file could not be ingested. Use Suricata EVE JSON or Zeek JSON logs.'), 'error');
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  };

  const hasEventFilters = !!(severityFilter || eventTypeFilter || sourceTypeFilter || sourceIdFilter || ipSearch.trim() || signatureSearch.trim() || timeWindow.started_at || timeWindow.ended_before);

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

      {importReceipt && <EventImportReceipt key={importReceipt.received_at} receipt={importReceipt} onDismiss={() => setImportReceipt(null)} />}

      {errors.length > 0 && !eventError && <DegradedBanner messages={errors} onRetry={() => void fetchEvents()} />}

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
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-surface-200">{source.name}</p>
                  <p className="text-xs text-surface-500">
                    {source.source_type} · {source.event_count} events · {source.last_event_at ? `last accepted at ${new Date(source.last_event_at).toLocaleString()}` : 'acceptance time not recorded'}
                  </p>
                </div>
                <button type="button" aria-pressed={sourceIdFilter === String(source.id)} onClick={() => { setSourceIdFilter(String(source.id)); setPage(1); }} className="max-w-full break-words rounded border border-surface-600 px-3 py-2 text-left text-xs text-primary-300">View events from {source.name}</button>
                <StatusBadge tone={source.status === 'active' ? 'success' : 'neutral'}>{source.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label="Event time window" className="oa-panel space-y-3 rounded-md p-4">
        <h2 className="text-sm font-semibold text-surface-200">Event time window (UTC)</h2>
        <form onSubmit={applyTimeWindow} className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 space-y-1 text-xs text-surface-400"><span className="block">Start, included (UTC)</span><input aria-label="Event start time UTC" type="datetime-local" step="0.001" value={startInput} onChange={event => setStartInput(event.target.value)} className="max-w-full rounded border border-surface-600 bg-surface-900 px-2 py-2 text-sm text-surface-200" /></label>
          <label className="min-w-0 space-y-1 text-xs text-surface-400"><span className="block">End, excluded (UTC)</span><input aria-label="Event end time UTC" type="datetime-local" step="0.001" value={endInput} onChange={event => setEndInput(event.target.value)} className="max-w-full rounded border border-surface-600 bg-surface-900 px-2 py-2 text-sm text-surface-200" /></label>
          <button type="submit" className="rounded border border-surface-600 px-3 py-2 text-sm text-primary-300">Apply time window</button>
          <button type="button" onClick={() => { setStartInput(''); setEndInput(''); setTimeWindow({}); setTimeError(''); setPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-sm text-surface-200">Clear time window</button>
        </form>
        {timeError && <p role="alert" className="text-xs text-danger-400">{timeError}</p>}
        {timeDirty && <p className="text-xs text-warning-300">Time draft not applied. Results, saved views and CSV export still use the applied window below.</p>}
        <p className="break-words text-xs text-surface-400 [overflow-wrap:anywhere]">Applied window: {timeWindow.started_at ?? 'No start limit'} to {timeWindow.ended_before ?? 'No end limit'} (end excluded). Filters use event timestamps, not upload times. Severity counts and sensor totals above cover all recorded events.</p>
      </section>

      <section aria-label="Recorded source filter" className="oa-panel space-y-2 p-4">
        <label htmlFor="recorded-event-source" className="block text-xs text-surface-400">Recorded source</label>
        <select id="recorded-event-source" value={sourceIdFilter} onChange={event => { setSourceIdFilter(event.target.value); setPage(1); }} className="w-full min-w-0 rounded border border-surface-600 bg-surface-900 px-2 py-2 text-sm text-surface-200 sm:max-w-lg">
          <option value="">All recorded sources</option>
          {sourceIdFilter && !sources.some(source => String(source.id) === sourceIdFilter) && <option value={sourceIdFilter}>Source #{sourceIdFilter} (details unavailable)</option>}
          {sources.map(source => <option key={source.id} value={source.id}>{source.name} (#{source.id}, {source.source_type})</option>)}
        </select>
        <p className="break-words text-xs text-surface-400">{sourceIdFilter ? `Filtering source #${sourceIdFilter}. Other applied filters still narrow results.` : 'All sources included.'} Source totals are lifetime recorded counts, not a live sensor health check. CSV export and saved views use this selection.</p>
        {sourceIdFilter && <button type="button" onClick={() => { setSourceIdFilter(''); setPage(1); }} className="text-xs text-primary-300">Clear recorded source</button>}
      </section>

      {/* Event filters */}
      <div className="flex items-center gap-4 flex-wrap">
      <SavedViewsMenu<EventViewFilters>
        basePath="/events/views/"
        currentFilters={{
          ...(severityFilter ? { severity: severityFilter } : {}),
          ...(eventTypeFilter ? { event_type: eventTypeFilter } : {}),
          ...(sourceTypeFilter ? { source_type: sourceTypeFilter } : {}),
          ...(sourceIdFilter ? { source_id: Number(sourceIdFilter) } : {}),
          ...(ipSearch.trim() ? { ip: ipSearch.trim() } : {}),
          ...(signatureSearch.trim() ? { signature: signatureSearch.trim() } : {}),
          sort,
          ...timeWindow,
        }}
        onApply={(filters: EventViewFilters) => {
          setTimeWindow({ ...(filters.started_at ? { started_at: filters.started_at } : {}), ...(filters.ended_before ? { ended_before: filters.ended_before } : {}) });
          setStartInput(utcInput(filters.started_at)); setEndInput(utcInput(filters.ended_before)); setTimeError('');
          setSeverityFilter(filters.severity ?? '');
          setEventTypeFilter(filters.event_type ?? '');
          setSourceTypeFilter(filters.source_type ?? '');
          setSourceIdFilter(filters.source_id ? String(filters.source_id) : '');
          setIpSearch(filters.ip ?? '');
          setSignatureSearch(filters.signature ?? '');
          setSort(filters.sort ?? 'timestamp_desc');
          setPage(1);
        }}
      />
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
      <button
        type="button"
        onClick={() => { void exportCsv(); }}
        disabled={exporting}
        className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded text-xs text-surface-200 transition-colors disabled:opacity-50"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {exporting ? 'Exporting...' : 'Export CSV'}
      </button>
      </div>

      {/* Event Table */}
      {loading ? (
        <LoadingSurface rows={5} label="Loading security events" />
      ) : eventError ? (
        <ErrorState title="Event stream unavailable" description={eventError} action={<RetryButton onClick={() => void fetchEvents()} />} />
      ) : events.length === 0 ? (
        <div className="text-center py-20">
          <Activity className="w-16 h-16 text-surface-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-surface-300">{hasEventFilters ? 'No events match these filters' : 'No events ingested yet'}</h3>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            {hasEventFilters ? 'Try a wider applied time window or adjust the other event filters.' : 'Upload Suricata EVE JSON or Zeek logs, or configure a webhook receiver for real-time ingestion.'}
          </p>
        </div>
      ) : (
        <div className="oa-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left p-3 text-surface-400 font-medium w-8"><span className="sr-only">Details</span></th>
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
                  <Fragment key={e.id}>
                  <tr className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="p-3">
                      <button
                        type="button"
                        aria-label={`${expandedId === e.id ? 'Hide' : 'Show'} details for event ${e.id}`}
                        aria-expanded={expandedId === e.id}
                        onClick={() => setExpandedId(current => current === e.id ? null : e.id)}
                        className="p-1 text-surface-500 hover:text-surface-200 transition-colors"
                      >
                        {expandedId === e.id ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </td>
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
                  {expandedId === e.id && (
                    <tr className="border-b border-surface-800 bg-surface-900/60">
                      <td colSpan={9} className="px-6 py-4">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                          {[
                            ['Action', e.action],
                            ['Protocol', e.protocol],
                            ['Hostname', e.hostname],
                            ['Username', e.username],
                            ['Domain', e.domain],
                            ['URL', e.url],
                            ['User agent', e.user_agent],
                            ['Bytes in/out', e.bytes_in != null || e.bytes_out != null ? `${e.bytes_in ?? 0} / ${e.bytes_out ?? 0}` : null],
                          ].map(([label, value]) => (
                            <div key={label as string}>
                              <dt className="text-surface-500">{label}</dt>
                              <dd className="mt-0.5 break-words text-surface-200">{(value as string | null) ?? '—'}</dd>
                            </div>
                          ))}
                        </dl>
                        {e.raw_data && (
                          <pre aria-label="Raw event payload" className="mt-3 max-h-56 overflow-auto rounded-md border border-surface-700 bg-surface-950 p-3 text-[11px] text-surface-300">{JSON.stringify(e.raw_data, null, 2)}</pre>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
  const [review, setReview] = useState<EventFileReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const readVersion = useRef(0);
  useEffect(() => () => { readVersion.current++; }, []);
  const chooseFile = async (selected: File | null) => {
    const version = ++readVersion.current;
    setFile(selected); setReview(null); setFormError(''); setReviewing(Boolean(selected));
    if (!selected) return;
    try {
      const next = await reviewEventFile(selected);
      if (version === readVersion.current) setReview(next);
    } catch (err) {
      if (version === readVersion.current) setFormError(err instanceof Error ? err.message : 'File could not be reviewed.');
    } finally { if (version === readVersion.current) setReviewing(false); }
  };
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!uploading) onClose(); });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !review || reviewing) {
      setFormError(file ? 'Choose a valid file and wait for its review before uploading.' : 'Choose a file to upload.');
      return;
    }
    setFormError('');
    onUpload(file, sourceType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm" onClick={() => { if (!uploading) onClose(); }}></div>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="event-upload-title" className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 p-4 sm:p-6 shadow-[var(--oa-shadow-float)]">
        <h2 id="event-upload-title" className="mb-1 text-lg font-semibold text-surface-50">Upload events</h2>
        <p className="mb-4 text-xs text-surface-500">Review the file locally before upload. UTF-8 JSON object, array or newline-delimited JSON, up to 10 MiB and 50,000 records.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="event-upload-file" className="mb-1 block text-sm font-medium text-surface-300">Log file</label>
            <input
              id="event-upload-file"
              type="file"
              accept=".json,.log,.eve,.ndjson,application/json"
              disabled={uploading}
              onChange={e => { void chooseFile(e.target.files?.[0] ?? null); }}
              className="w-full text-sm text-surface-300 file:mr-3 file:rounded-md file:border file:border-surface-600 file:bg-surface-800 file:px-3 file:py-1.5 file:text-xs file:text-surface-200"
            />
          </div>
          <div>
            <label htmlFor="event-upload-type" className="mb-1 block text-sm font-medium text-surface-300">Source type</label>
            <select
              id="event-upload-type"
              disabled={uploading}
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="suricata">Suricata (EVE JSON)</option>
              <option value="zeek">Zeek (JSON logs)</option>
            </select>
          </div>
          {reviewing && <p role="status" className="text-xs text-surface-400">Reading and validating the selected file locally...</p>}
          {file && review && <section aria-label="Selected event file review" className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
            <p className="break-all font-medium text-surface-100">{file.name}</p>
            <p>{review.format} · {review.records.toLocaleString()} JSON records · {file.size.toLocaleString()} bytes</p>
            <p>Selected parser: {sourceType === 'suricata' ? 'Suricata (EVE JSON)' : 'Zeek (JSON logs)'}</p>
            <p>Destination: your event stream and a source named after this file.</p>
            <p className="break-words">Sample field names (first three records, up to 20, long names shortened): {review.sampleFields.join(', ') || 'Empty objects'}</p>
            <p className="text-surface-400">JSON validation is not source-parser acceptance. Unsupported records may still be skipped; the final import reports ingested and skipped counts. {uploading ? 'Submitting this reviewed file...' : 'No records have been sent yet.'}</p>
          </section>}
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
              disabled={uploading || reviewing || (file !== null && review === null)}
              className="rounded-md bg-primary-500 px-3.5 py-1.5 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-40"
            >
              {uploading ? 'Uploading...' : review ? `Upload ${review.records.toLocaleString()} ${review.records === 1 ? 'record' : 'records'}` : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
