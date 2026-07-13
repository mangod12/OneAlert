import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowUpRight, Bot, Crosshair,
  Radar, Server, ShieldAlert, ShieldCheck, Workflow,
} from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import type { AlertStats, Alert, AlertListResponse } from '../api/types';
import { KPICard } from '../components/KPICard';
import { SeverityBreakdown } from '../components/charts/SeverityBreakdown';
import { AlertTrend } from '../components/charts/AlertTrend';
import { RiskHeatmap } from '../components/charts/RiskHeatmap';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';

type DashboardErrors = Partial<Record<'stats' | 'assets' | 'devices' | 'alerts', string>>;

export function Dashboard() {
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [totalAssets, setTotalAssets] = useState<number | null>(null);
  const [totalDiscovered, setTotalDiscovered] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [errors, setErrors] = useState<DashboardErrors>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadDashboard = useCallback(() => {
    setRefreshKey(key => key + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      setErrors({});
      const requests = [
        apiClient.get<AlertStats>('/alerts/stats/overview'),
        apiClient.get<{ total?: number }>('/assets/', { params: { size: 1 } }),
        apiClient.get<{ total?: number }>('/ot/discovered-devices', { params: { size: 1 } }),
        apiClient.get<AlertListResponse>('/alerts/', { params: { size: 50 } }),
      ] as const;
      const results = await Promise.allSettled(requests);
      if (!active) return;

      const nextErrors: DashboardErrors = {};
      if (results[0].status === 'fulfilled') setStats(results[0].value.data);
      else nextErrors.stats = getApiErrorMessage(results[0].reason, 'Alert statistics are unavailable');
      if (results[1].status === 'fulfilled') setTotalAssets(results[1].value.data.total ?? 0);
      else nextErrors.assets = getApiErrorMessage(results[1].reason, 'Asset inventory is unavailable');
      if (results[2].status === 'fulfilled') setTotalDiscovered(results[2].value.data.total ?? 0);
      else nextErrors.devices = getApiErrorMessage(results[2].reason, 'Discovery telemetry is unavailable');
      if (results[3].status === 'fulfilled') setAlerts(results[3].value.data.alerts ?? []);
      else nextErrors.alerts = getApiErrorMessage(results[3].reason, 'Recent alert activity is unavailable');

      setErrors(nextErrors);
      setLastUpdated(new Date());
      setLoading(false);
    };
    void fetchData();
    return () => { active = false; };
  }, [refreshKey]);

  const hasAnyData = stats !== null || totalAssets !== null || totalDiscovered !== null || alerts !== null;
  const errorMessages = Object.values(errors);
  if (loading && !hasAnyData) return <LoadingSurface rows={7} label="Loading security operations dashboard" />;
  if (!hasAnyData && errorMessages.length > 0) {
    return <ErrorState title="Command data could not be loaded" description={errorMessages.join(' · ')} action={<RetryButton onClick={loadDashboard} />} />;
  }

  const totalAlerts = stats?.total_alerts;
  const criticalAlerts = stats?.critical_alerts;
  const highAlerts = stats?.high_alerts;
  const unresolvedAlerts = stats ? stats.pending_alerts + stats.acknowledged_alerts : null;
  const agentConfidence = stats && stats.total_alerts > 0
    ? Math.max(54, Math.round(((stats.total_alerts - stats.critical_alerts) / stats.total_alerts) * 100))
    : stats ? 96 : null;

  const priorityAlerts = (alerts ?? [])
    .filter(alert => alert.severity === 'critical' || alert.severity === 'high')
    .slice(0, 4);

  const agentLanes = [
    { label: 'Detect', value: totalDiscovered !== null && totalAssets !== null ? totalDiscovered + totalAssets : null, status: 'online', icon: Radar },
    { label: 'Triage', value: unresolvedAlerts, status: unresolvedAlerts === null ? 'unknown' : unresolvedAlerts > 0 ? 'queued' : 'clear', icon: Bot },
    { label: 'Hunt', value: highAlerts !== undefined && criticalAlerts !== undefined ? highAlerts + criticalAlerts : null, status: 'ready', icon: Crosshair },
    { label: 'Respond', value: 0, status: 'approval gated', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="OneAlert command"
        title="Security Operations"
        description="A prioritized view of OT exposure, live telemetry, investigations, and governed agent readiness."
        meta={<div className="flex flex-wrap items-center gap-2"><StatusBadge tone="success">Monitoring active</StatusBadge><span className="text-xs text-surface-500">Updated {lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—'}</span></div>}
        actions={<Link to="/cases" className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400">Open investigations <ArrowUpRight className="h-4 w-4" /></Link>}
      />

      {errorMessages.length > 0 && <DegradedBanner messages={errorMessages} onRetry={loadDashboard} />}

      <section aria-label="Security posture metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard title="Total alerts" value={totalAlerts ?? '—'} icon={ShieldAlert} color="info" detail={stats ? `${unresolvedAlerts} unresolved` : 'Data unavailable'} />
        <KPICard title="Critical exposure" value={criticalAlerts ?? '—'} icon={AlertTriangle} color="danger" detail={stats ? `${highAlerts} high severity` : 'Data unavailable'} />
        <KPICard title="Managed assets" value={totalAssets ?? '—'} icon={Server} color="success" detail="Inventory scope" />
        <KPICard title="Discovered devices" value={totalDiscovered ?? '—'} icon={Activity} color="warning" detail="Passive telemetry" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Panel title="Priority insight hub" description="Highest-severity items requiring analyst attention." action={<Link to="/alerts" className="text-xs font-semibold text-primary-300 hover:text-primary-200">View all alerts</Link>}>
          <div className="divide-y divide-surface-800">
            {priorityAlerts.length > 0 ? priorityAlerts.map(alert => (
              <Link key={alert.id} to="/alerts" className="grid gap-3 px-5 py-3.5 hover:bg-surface-800/45 sm:grid-cols-[6rem_minmax(0,1fr)_8rem] sm:items-center">
                <StatusBadge tone={alert.severity === 'critical' ? 'danger' : 'warning'}>{alert.severity}</StatusBadge>
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{alert.title}</p><p className="mt-0.5 truncate font-mono text-[11px] text-surface-500">{alert.cve_id || alert.source} · {alert.asset_name}</p></div>
                <span className="text-right text-xs text-surface-500">{alert.status}</span>
              </Link>
            )) : (
              <div className="px-5 py-8 text-center text-sm text-surface-400">{alerts === null ? 'Recent alert activity is unavailable.' : 'No critical or high alerts require prioritization.'}</div>
            )}
          </div>
        </Panel>

        <Panel title="Agent operations" description="Readiness across governed analysis lanes.">
          <div className="grid grid-cols-2 gap-px bg-surface-800">
            {agentLanes.map(lane => (
              <div key={lane.label} className="bg-surface-900 px-4 py-4">
                <div className="flex items-center justify-between"><lane.icon className="h-4 w-4 text-primary-300" /><span className="text-[9px] font-bold uppercase tracking-wider text-surface-500">{lane.status}</span></div>
                <p className="mt-3 text-2xl font-bold tabular-nums text-surface-50">{lane.value ?? '—'}</p>
                <p className="mt-0.5 text-xs text-surface-400">{lane.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-surface-800 px-4 py-3 text-xs"><span className="flex items-center gap-2 text-surface-400"><Workflow className="h-4 w-4 text-success" /> Human approval enforced</span><strong className="text-primary-200">{agentConfidence ?? '—'}{agentConfidence !== null ? '%' : ''}</strong></div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Severity distribution" description="Current alert inventory by operational severity."><div className="p-4"><SeverityBreakdown stats={stats} /></div></Panel>
        <Panel title="Alert activity · 7 days" description="Daily volume grouped by severity."><div className="p-4"><AlertTrend alerts={alerts ?? []} /></div></Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Panel title="OT zone risk" description="Concentration of exposure across industrial network zones."><div className="p-4"><RiskHeatmap /></div></Panel>
        <Panel title="Telemetry health" description="Coverage signals from managed and discovered infrastructure.">
          <div className="space-y-4 p-5">
            {[
              { label: 'Managed assets', value: totalAssets, tone: 'bg-primary-400' },
              { label: 'Discovered devices', value: totalDiscovered, tone: 'bg-success' },
              { label: 'Open investigations', value: unresolvedAlerts, tone: 'bg-warning' },
              { label: 'Critical exposure', value: criticalAlerts ?? null, tone: 'bg-danger' },
            ].map(item => (
              <div key={item.label}><div className="flex items-center justify-between text-xs"><span className="text-surface-400">{item.label}</span><strong className="tabular-nums text-surface-100">{item.value ?? '—'}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800"><div className={`h-full ${item.tone}`} style={{ width: item.value === null ? '0%' : `${Math.min(100, Math.max(item.value > 0 ? 8 : 0, item.value * 9))}%` }} /></div></div>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}
