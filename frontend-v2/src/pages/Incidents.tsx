import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Siren } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ events: TimelineEvent[] }>(`/incidents/${assetId}/timeline`)
      .then(res => { if (!cancelled) setEvents(res.data.events); })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'The timeline could not be loaded.')); });
    return () => { cancelled = true; };
  }, [assetId]);

  if (error) return <p role="alert" className="mt-2 text-xs text-danger-400">{error}</p>;
  if (events === null) return <p className="mt-2 text-xs text-surface-500">Loading timeline…</p>;
  if (events.length === 0) return <p className="mt-2 text-xs text-surface-500">No timeline events</p>;
  return (
    <ol className="mt-2 space-y-1.5" aria-label="Incident timeline">
      {events.map((event, index) => (
        <li key={index} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 text-surface-300">
            <span className="font-medium text-surface-200">{kindLabels[event.kind] ?? event.kind}</span>
            {event.title && <span className="text-surface-400"> · {event.title}</span>}
            {event.detail && <span className="text-surface-500"> — {event.detail}</span>}
          </span>
          {event.timestamp && (
            <span className="shrink-0 text-[11px] text-surface-500">{new Date(event.timestamp).toLocaleString()}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Incidents() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ incidents: Incident[] }>('/incidents');
      setIncidents(res.data.incidents);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Incidents could not be loaded.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return <ErrorState title="Incidents unavailable" description={error} action={<RetryButton onClick={() => void load()} />} />;
  }

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Correlated groups of active alerts hitting the same asset, with blast radius from observed network connections."
      />
      {incidents === null ? (
        <LoadingSurface label="Correlating alerts" />
      ) : incidents.length === 0 ? (
        <EmptyState
          title="No incidents"
          description="When two or more active alerts hit the same asset they are grouped here as an incident."
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
                    <Link
                      to={`/alerts?asset_id=${incident.asset_id}`}
                      className="text-xs font-medium text-primary-400 hover:text-primary-300"
                    >
                      View these alerts in the alert list
                    </Link>
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
