import { IncidentHistoryExport } from '../components/IncidentHistoryExport';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, Siren } from 'lucide-react';
import { incidentCsv } from '../utils/incidentCsv';
import { IncidentEscalationReview } from '../components/IncidentEscalationReview';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones, alertStatusTones, caseStatusTones } from '../components/ui/tones';

interface IncidentAlert {
  id: number;
  cve_id: string | null;
  title: string;
  severity: string;
  status: string;
  created_at: string | null;
}

interface LinkedCase {
  id: number;
  title: string;
  status: string;
}

interface Incident {
  asset_id: number;
  asset_name: string;
  asset_vendor: string | null;
  asset_product: string | null;
  asset_criticality: string | null;
  max_severity: string;
  alert_count: number;
  shared_cves: string[];
  first_seen: string | null;
  last_seen: string | null;
  blast_radius: number;
  linked_cases: LinkedCase[];
  alerts: IncidentAlert[];
}

interface TimelineEvent {
  kind: string;
  alert_id: number | null;
  title: string | null;
  detail: string | null;
  timestamp: string | null;
}

const kindLabels: Record<string, string> = {
  alert_created: 'Alert raised',
  alert_updated: 'Alert updated',
};

function IncidentTimeline({ assetId }: { assetId: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [kinds, setKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setEvents(null); setError(null);
    apiClient.get<{ events: TimelineEvent[]; total: number; kinds: string[] }>(`/incidents/${assetId}/timeline`, {
      params: { page, page_size: 20, ...(appliedSearch ? { search: appliedSearch } : {}), ...(kind ? { kind } : {}) },
    })
      .then(res => { if (!cancelled) { setEvents(res.data.events); setTotal(res.data.total); setKinds(res.data.kinds); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'The timeline could not be loaded.')); });
    return () => { cancelled = true; };
  }, [assetId, retry, page, appliedSearch, kind]);

  const pages = Math.max(1, Math.ceil(total / 20));
  const currentPage = page;
  const visible = events ?? [];
  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-surface-400">Search all recorded alert events for this asset, including resolved alerts and evidence older than the latest 100 events. Titles and severity on creation rows reflect current alert values; change details reflect the saved audit record.</p>
      <form onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()); setPage(1); }} className="flex flex-wrap gap-2">
        <input aria-label="Search incident history" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Title, detail or alert ID" className="min-w-0 basis-full sm:basis-0 sm:flex-1 rounded border border-surface-600 bg-surface-800 px-2.5 py-1.5 text-sm text-surface-100" />
        <button type="submit" className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-primary-300">Search history</button>
        <select aria-label="Timeline event kind" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className="max-w-full rounded border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs text-surface-200"><option value="">All event kinds</option>{kinds.map(value => <option key={value} value={value}>{kindLabels[value] ?? value}</option>)}</select>
        {(appliedSearch || kind) && <button type="button" onClick={() => { setSearch(''); setAppliedSearch(''); setKind(''); setPage(1); }} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-200">Clear history filters</button>}
      </form>
      <IncidentHistoryExport key={`${assetId}:${appliedSearch}:${kind}`} assetId={assetId} search={appliedSearch} kind={kind} disabled={events === null || !!error} />
      {search.trim() !== appliedSearch && <p className="text-xs text-warning-300">Search draft not applied. Results use {appliedSearch ? `"${appliedSearch}"` : 'all keywords'}.</p>}
      {error ? <div className="space-y-2"><p role="alert" className="text-xs text-danger-400">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-primary-300">Retry incident timeline</button></div> : events === null ? <p role="status" className="text-xs text-surface-500">Loading timeline...</p> : <>
      <p className="text-xs text-surface-500">{total} recorded events match{appliedSearch ? ` "${appliedSearch}"` : ''}. Showing {visible.length ? (page - 1) * 20 + 1 : 0} to {visible.length ? Math.min(page * 20, total) : 0}.</p>
      {visible.length === 0 ? <div className="space-y-2"><p className="text-xs text-surface-400">No timeline events match these filters.</p>{page > 1 && <button type="button" onClick={() => setPage(1)} className="text-xs text-primary-300">Return to first history page</button>}</div> : <ol className="space-y-2" aria-label="Incident timeline">
        {visible.map((event, index) => <li key={`${currentPage}-${index}`} className="space-y-1 rounded border border-surface-700 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-surface-200">{kindLabels[event.kind] ?? event.kind}</span><span className="text-[11px] text-surface-500">{event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Time not recorded'}</span></div>
          {event.alert_id != null && <p className="text-xs text-surface-400">Alert #{event.alert_id}</p>}
          {event.title && <p className="break-words text-surface-300 [overflow-wrap:anywhere]">{event.title}</p>}
          <p className="whitespace-pre-wrap break-words text-xs text-surface-400 [overflow-wrap:anywhere]">{event.detail?.trim() ? event.detail : 'Detail not recorded'}</p>
        </li>)}
      </ol>}
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-surface-400">Timeline page {currentPage} of {pages}</span><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-200 disabled:opacity-40">Previous events</button><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-200 disabled:opacity-40">More events</button></div></div>
      </>}
    </div>
  );
}

export function Incidents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const assetValues = searchParams.getAll('asset_id');
  const assetValue = assetValues.length === 1 ? assetValues[0] : '';
  const exactAssetId = /^[1-9][0-9]*$/.test(assetValue) && Number.isSafeInteger(Number(assetValue)) ? Number(assetValue) : null;
  const invalidAssetLink = assetValues.length > 0 && exactAssetId === null;
  const clearExactLink = () => setSearchParams(current => { const next = new URLSearchParams(current); next.delete('asset_id'); return next; }, { replace: true });
  const [copyError, setCopyError] = useState(''), [copiedId, setCopiedId] = useState<number | null>(null);
  const copyIncidentLink = async (id: number) => {
    setCopyError(''); setCopiedId(null);
    try { const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('asset_id', String(id)); await navigator.clipboard.writeText(url.toString()); setCopiedId(id); }
    catch { setCopyError('The incident link could not be copied. Try again.'); }
  };
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [escalating, setEscalating] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState('');
  const [assetQuery, setAssetQuery] = useState('');
  const [appliedAssetQuery, setAppliedAssetQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const [loadedFilterKey, setLoadedFilterKey] = useState<string | null>(null);
  const filterKey = JSON.stringify([exactAssetId, ...(exactAssetId ? [] : [severityFilter, appliedAssetQuery.trim()])]);


  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (invalidAssetLink) { setIncidents(null); setLoading(false); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (exactAssetId) params.asset_id = String(exactAssetId);
      else { if (severityFilter) params.severity = severityFilter;
        if (appliedAssetQuery.trim()) params.asset = appliedAssetQuery.trim(); }
      const res = await apiClient.get<{ incidents: Incident[] }>('/incidents', { params });
      if (id !== requestId.current) return;
      if (exactAssetId && res.data.incidents.some(row => row.asset_id !== exactAssetId)) throw new Error('The response did not match this exact asset incident. Retry before reviewing it.');
      setIncidents(res.data.incidents);
      setLoadedFilterKey(JSON.stringify([exactAssetId, ...(exactAssetId ? [] : [severityFilter, appliedAssetQuery.trim()])]));
      setExpanded(exactAssetId);
    } catch (err: unknown) {
      if (id === requestId.current) setError(getApiErrorMessage(err, 'Incidents could not be loaded.'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [severityFilter, appliedAssetQuery, exactAssetId, invalidAssetLink]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const exportReady = !loading && loadedFilterKey === filterKey && !!incidents?.length;
  const exportCsv = () => {
    if (!exportReady || !incidents) return;
    const url = URL.createObjectURL(new Blob([incidentCsv(incidents)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incidents.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (invalidAssetLink) return <ErrorState title="Invalid incident record link" description="Use one positive whole-number asset ID. No incident was loaded from this link." action={<button type="button" onClick={clearExactLink} className="rounded border border-surface-600 px-3 py-2 text-sm text-surface-200">Clear invalid incident link</button>} />;

  if (error) {
    return <ErrorState title="Incidents unavailable" description={error} action={<RetryButton onClick={() => void load()} />} />;
  }

  return (
    <div>
      {escalating !== null && <IncidentEscalationReview key={escalating} assetId={escalating} onClose={() => setEscalating(null)} onCreated={id => navigate(`/cases/${id}`)} />}
      <PageHeader
        actions={<button type="button" onClick={exportCsv} disabled={!exportReady}
          className="flex items-center gap-2 rounded-md border border-surface-700 px-3 py-2 text-xs text-surface-200 hover:bg-surface-800 disabled:opacity-40">
          <Download className="h-4 w-4" aria-hidden="true" /> Export filtered CSV
        </button>}
        title="Incidents"
        description="Correlated groups of active alerts hitting the same asset, with blast radius from observed network connections."
      />
      {exactAssetId && <div className="mb-4 space-y-2 rounded border border-primary-500/30 p-3 text-sm text-surface-300"><p>Exact current incident for asset #{exactAssetId}. Other list filters are not applied. Incidents are computed from active alerts and may no longer qualify when reopened. This link is not an immutable incident ID and does not grant access.</p><button type="button" onClick={clearExactLink} className="rounded border border-surface-600 px-3 py-2 text-xs">Return to filtered incident list</button></div>}
      {!exactAssetId && <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          aria-label="Minimum severity"
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="rounded-md border border-surface-700 bg-surface-950 px-2.5 py-1.5 text-xs text-surface-300 focus:border-primary-500 focus:outline-none"
        >
          <option value="">Any severity</option>
          <option value="critical">Critical and above</option>
          <option value="high">High and above</option>
          <option value="medium">Medium and above</option>
          <option value="low">Low and above</option>
        </select>
        <form
          onSubmit={e => { e.preventDefault(); setAppliedAssetQuery(assetQuery); }}
          className="flex gap-2"
        >
          <input
            value={assetQuery}
            onChange={e => setAssetQuery(e.target.value)}
            placeholder="Filter by asset, vendor, or product..."
            aria-label="Filter incidents by asset"
            maxLength={120}
            className="min-h-9 w-64 rounded-md border border-surface-700 bg-surface-950 px-3 text-sm text-surface-100 placeholder:text-surface-500 focus:border-primary-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500"
          >
            Apply
          </button>
        </form>
      </div>}
      {copyError && <p role="alert" className="mb-3 text-xs text-danger">{copyError}</p>}
      <p className="mb-3 text-xs text-surface-500">CSV includes only the currently loaded filtered incidents. Downloads stay on your device.</p>
      {loading || loadedFilterKey !== filterKey || incidents === null ? (
        <LoadingSurface label="Correlating alerts" />
      ) : incidents.length === 0 ? (
        <EmptyState
          title="No incidents"
          description={exactAssetId ? `No qualifying current incident is visible for asset #${exactAssetId}. It may have fewer than two active alerts, be unavailable or no longer be accessible. No resolution or historical state is inferred.` : 'When two or more active alerts hit the same asset they are grouped here as an incident.'}
        />
      ) : (
        <ul className="space-y-3">
          {incidents.map(incident => {
            const isOpen = expanded === incident.asset_id;
            return (
              <li key={incident.asset_id} className="rounded-lg border border-surface-700 bg-surface-900/60">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : incident.asset_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-surface-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-surface-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Siren className="h-4 w-4 text-surface-400" />
                      <span className="font-semibold text-surface-100">{incident.asset_name}</span>
                      {(incident.asset_vendor || incident.asset_product) && (
                        <span className="text-sm text-surface-400">
                          {[incident.asset_vendor, incident.asset_product].filter(Boolean).join(' ')}
                        </span>
                      )}
                      <StatusBadge tone={alertSeverityTones[incident.max_severity] ?? 'neutral'}>{incident.max_severity}</StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-surface-500">
                      {incident.alert_count} active alerts
                      {incident.shared_cves.length > 0 && ` · ${incident.shared_cves.join(', ')}`}
                      {incident.blast_radius > 0 && ` · blast radius ${incident.blast_radius} connection${incident.blast_radius === 1 ? '' : 's'}`}
                      {incident.last_seen && ` · latest ${new Date(incident.last_seen).toLocaleString()}`}
                    </p>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-surface-700 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        to={`/alerts?asset_id=${incident.asset_id}`}
                        className="text-xs font-medium text-primary-400 hover:text-primary-300"
                      >
                        View these alerts in the alert list
                      </Link>
                      <button
                        type="button"
                        disabled={escalating !== null}
                        onClick={() => setEscalating(incident.asset_id)}
                        className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-500 disabled:opacity-40"
                      >
                        Escalate to investigation
                      </button>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {incident.alerts.map(alert => (
                        <li key={alert.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <StatusBadge tone={alertSeverityTones[alert.severity] ?? 'neutral'}>{alert.severity}</StatusBadge>
                          <StatusBadge tone={alertStatusTones[alert.status] ?? 'neutral'}>{alert.status}</StatusBadge>
                          <span className="text-surface-200">{alert.title}</span>
                          {alert.cve_id && <span className="text-xs text-surface-500">{alert.cve_id}</span>}
                        </li>
                      ))}
                    </ul>
                    {incident.linked_cases.length > 0 && (
                      <p className="mt-3 text-xs text-surface-500">
                        Linked investigations:{' '}
                        {incident.linked_cases.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ', '}
                            <Link to={`/cases/${c.id}`} className="text-primary-400 hover:text-primary-300">{c.title}</Link>
                            {' '}<StatusBadge tone={caseStatusTones[c.status] ?? 'neutral'}>{c.status}</StatusBadge>
                          </span>
                        ))}
                      </p>
                    )}
                    <div className="mt-3 border-t border-surface-700 pt-3">
                      <p className="text-xs uppercase tracking-wide text-surface-500">Timeline</p>
                      <div className="space-y-2"><button type="button" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300" onClick={() => void copyIncidentLink(incident.asset_id)}>Copy current incident link</button><p className="text-xs text-surface-400">Opens the current correlated group by asset ID, not a frozen incident snapshot. Recipients need their own access.</p>{copiedId === incident.asset_id && <p role="status" className="text-xs text-primary-300">Current incident link copied.</p>}<Link className="block text-xs text-primary-300" to={`/assets?asset=${incident.asset_id}`}>Open exact asset inventory record</Link></div>
                      <IncidentTimeline assetId={incident.asset_id} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
