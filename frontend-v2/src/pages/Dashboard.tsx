import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowUpRight, Bot, CheckSquare, Clock, Crosshair,
  Radar, Server, ShieldAlert, ShieldCheck, Square, Timer, Workflow,
} from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import type { AlertStats, Alert, AlertListResponse, ResponseMetrics } from '../api/types';
import { KPICard } from '../components/KPICard';
import { SeverityBreakdown } from '../components/charts/SeverityBreakdown';
import { AlertTrend } from '../components/charts/AlertTrend';
import type { TimelineDay } from '../components/charts/trendData';
import { RiskHeatmap } from '../components/charts/RiskHeatmap';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatDuration } from '../utils/formatDuration';

type DashboardErrors = Partial<Record<'stats' | 'assets' | 'devices' | 'alerts', string>>;

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [totalAssets, setTotalAssets] = useState<number | null>(null);
  const [totalDiscovered, setTotalDiscovered] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineDay[] | null>(null);
  const [responseMetrics, setResponseMetrics] = useState<ResponseMetrics | null>(null);
  const [myAlerts, setMyAlerts] = useState<Alert[] | null>(null);
  const [myCases, setMyCases] = useState<Array<{ id: number; title: string; severity: string; status: string }> | null>(null);
  const [watchingAlerts, setWatchingAlerts] = useState<Alert[] | null>(null);
  const [watchingCases, setWatchingCases] = useState<Array<{ id: number; title: string; severity: string; status: string; due_date: string | null }> | null>(null);
  const [todayStr, setTodayStr] = useState<string | null>(null);
  const [weekStr, setWeekStr] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    setTodayStr(now.toISOString().slice(0, 10));
    setWeekStr(new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10));
  }, []);
  const [myTasks, setMyTasks] = useState<Array<{ task_id: number; case_id: number; case_title: string; case_severity: string; case_status: string; case_due_date: string | null; title: string; due_date: string | null; created_at: string }> | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);

  const setMyTaskDueDate = async (task: { task_id: number; case_id: number; title: string }, dueDate: string | null) => {
    try {
      await apiClient.patch(`/cases/${task.case_id}/tasks/${task.task_id}`, { due_date: dueDate });
      setMyTasks(prev => prev?.map(t => t.task_id === task.task_id ? { ...t, due_date: dueDate } : t) ?? prev);
    } catch {
      // leave the row unchanged so the action can be retried
    }
  };

  const completeTask = async (task: { task_id: number; case_id: number; title: string }) => {
    if (completingTaskId !== null) return;
    setCompletingTaskId(task.task_id);
    try {
      await apiClient.patch(`/cases/${task.case_id}/tasks/${task.task_id}`, { done: true });
      setMyTasks(prev => prev?.filter(t => t.task_id !== task.task_id) ?? prev);
    } catch {
      // leave the row in place so the action can be retried
    } finally {
      setCompletingTaskId(null);
    }
  };
  const [incidents, setIncidents] = useState<Array<{ asset_id: number; asset_name: string; max_severity: string; alert_count: number; blast_radius: number }> | null>(null);
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
        apiClient.get<AlertListResponse>('/alerts/', { params: { size: 5, assigned: 'me' } }),
        apiClient.get<{ cases?: Array<{ id: number; title: string; severity: string; status: string }> }>('/cases/', { params: { size: 5, assigned: 'me' } }),
        apiClient.get<{ days?: TimelineDay[] }>('/alerts/stats/timeline', { params: { days: 14 } }),
        apiClient.get<ResponseMetrics>('/alerts/stats/response-metrics', { params: { days: 30 } }),
        apiClient.get<{ incidents?: Array<{ asset_id: number; asset_name: string; max_severity: string; alert_count: number; blast_radius: number }> }>('/incidents'),
        apiClient.get<AlertListResponse>('/alerts/', { params: { size: 5, watching: 'me' } }),
        apiClient.get<{ cases?: Array<{ id: number; title: string; severity: string; status: string; due_date: string | null }> }>('/cases/', { params: { size: 5, watching: 'me' } }),
        apiClient.get<Array<{ task_id: number; case_id: number; case_title: string; case_severity: string; case_status: string; case_due_date: string | null; title: string; due_date: string | null; created_at: string }>>('/cases/my-tasks'),
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
      if (results[4].status === 'fulfilled') setMyAlerts(results[4].value.data.alerts ?? []);
      else setMyAlerts([]);
      if (results[5].status === 'fulfilled') setMyCases(results[5].value.data.cases ?? []);
      else setMyCases([]);
      if (results[6].status === 'fulfilled') setTimeline(results[6].value.data.days ?? []);
      else setTimeline(null);
      if (results[7].status === 'fulfilled') setResponseMetrics(results[7].value.data);
      else setResponseMetrics(null);
      if (results[8].status === 'fulfilled') setIncidents(results[8].value.data.incidents ?? []);
      else setIncidents([]);
      if (results[9].status === 'fulfilled') setWatchingAlerts(results[9].value.data.alerts ?? []);
      else setWatchingAlerts([]);
      if (results[10].status === 'fulfilled') setWatchingCases(results[10].value.data.cases ?? []);
      else setWatchingCases([]);
      if (results[11].status === 'fulfilled') setMyTasks(results[11].value.data ?? []);
      else setMyTasks([]);

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

      <section aria-label="Response readiness" className="grid grid-cols-2 gap-3">
        <KPICard title="Mean time to acknowledge" value={formatDuration(responseMetrics?.mtta_seconds ?? null)} icon={Clock} color="info" detail={responseMetrics ? `${responseMetrics.acknowledged_count} acknowledged · ${responseMetrics.days}d` : 'Data unavailable'} />
        <KPICard title="Mean time to resolve" value={formatDuration(responseMetrics?.mttr_seconds ?? null)} icon={Timer} color="success" detail={responseMetrics ? `${responseMetrics.resolved_count} resolved · ${responseMetrics.days}d` : 'Data unavailable'} />
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

      {(myAlerts === null || myCases === null || myAlerts.length > 0 || myCases.length > 0) && (
        <section aria-label="My assignments">
          <Panel title="My assignments" description="Open alerts and investigations assigned to you." action={<Link to="/alerts" className="text-xs font-semibold text-primary-300 hover:text-primary-200">View alerts</Link>}>
            <div className="grid gap-0 divide-y divide-surface-800 md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="divide-y divide-surface-800">
                {(myAlerts ?? []).length > 0 ? (myAlerts ?? []).map(alert => (
                  <Link key={alert.id} to="/alerts" className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                    <StatusBadge tone={alert.severity === 'critical' ? 'danger' : alert.severity === 'high' ? 'warning' : 'neutral'}>{alert.severity}</StatusBadge>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{alert.title}</p><p className="mt-0.5 truncate font-mono text-[11px] text-surface-500">{alert.cve_id || alert.source}</p></div>
                    <span className="ml-auto text-xs text-surface-500">{alert.status}</span>
                  </Link>
                )) : (
                  <div className="px-5 py-6 text-center text-sm text-surface-400">{myAlerts === null ? 'Loading...' : 'No alerts assigned to you.'}</div>
                )}
              </div>
              <div className="divide-y divide-surface-800">
                {(myCases ?? []).length > 0 ? (myCases ?? []).map(c => (
                  <Link key={c.id} to={`/cases/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                    <StatusBadge tone={c.severity === 'critical' ? 'danger' : c.severity === 'high' ? 'warning' : 'neutral'}>{c.severity}</StatusBadge>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{c.title}</p><p className="mt-0.5 truncate text-[11px] text-surface-500">Investigation #{c.id}</p></div>
                    <span className="ml-auto text-xs text-surface-500">{c.status}</span>
                  </Link>
                )) : (
                  <div className="px-5 py-6 text-center text-sm text-surface-400">{myCases === null ? 'Loading...' : 'No investigations assigned to you.'}</div>
                )}
              </div>
            </div>
          </Panel>
        </section>
      )}

      {(myTasks === null || myTasks.length > 0) && (
        <section aria-label="My tasks">
          <Panel title="My tasks" description="Open checklist tasks assigned to you across investigations, grouped by how soon they are due. Set or clear a due date inline.">
            <div className="divide-y divide-surface-800">
              {(myTasks ?? []).length > 0 ? (() => {
                const buckets: Array<{ key: string; label: string; items: typeof myTasks }> = [
                  { key: 'overdue', label: 'Overdue', items: [] },
                  { key: 'today', label: 'Due today', items: [] },
                  { key: 'week', label: 'Due this week', items: [] },
                  { key: 'later', label: 'Later', items: [] },
                  { key: 'none', label: 'No due date', items: [] },
                ];
                for (const t of myTasks ?? []) {
                  if (!t.due_date) buckets[4].items!.push(t);
                  else if (t.due_date < (todayStr ?? '')) buckets[0].items!.push(t);
                  else if (t.due_date === todayStr) buckets[1].items!.push(t);
                  else if (t.due_date <= (weekStr ?? '')) buckets[2].items!.push(t);
                  else buckets[3].items!.push(t);
                }
                return buckets.filter(b => (b.items ?? []).length > 0).map(bucket => (
                  <div key={bucket.key}>
                    <p className={`px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide ${bucket.key === 'overdue' ? 'text-danger' : 'text-surface-500'}`}>
                      {bucket.label} ({bucket.items!.length})
                    </p>
                    {(bucket.items ?? []).map(t => (
                      <div key={t.task_id} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                        <button
                          type="button"
                          aria-label={`Complete task ${t.title}`}
                          disabled={completingTaskId !== null}
                          onClick={() => void completeTask(t)}
                          className="shrink-0 text-primary-400 transition-colors hover:text-primary-300 disabled:opacity-40"
                        >
                          {completingTaskId === t.task_id
                            ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                            : <Square className="h-4 w-4" aria-hidden="true" />}
                        </button>
                        <StatusBadge tone={t.case_severity === 'critical' ? 'danger' : t.case_severity === 'high' ? 'warning' : 'neutral'}>{t.case_severity}</StatusBadge>
                        <Link to={`/cases/${t.case_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{t.title}</p><p className="mt-0.5 truncate text-[11px] text-surface-500">{t.case_title} · Investigation #{t.case_id}{t.case_due_date ? ` · due ${t.case_due_date}` : ''}</p></div>
                          {t.due_date && t.due_date < (todayStr ?? '') && (
                            <span className="shrink-0 rounded-full bg-danger/20 px-2 py-0.5 text-[10px] font-medium text-danger">Task overdue · due {t.due_date}</span>
                          )}
                          <span className="ml-auto shrink-0 text-xs text-surface-500">{t.case_status}</span>
                        </Link>
                        <input
                          type="date"
                          aria-label={`Due date for task ${t.title}`}
                          value={t.due_date ?? ''}
                          onChange={e => void setMyTaskDueDate(t, e.target.value || null)}
                          className="w-28 shrink-0 rounded-md border border-surface-700 bg-surface-950 px-1.5 py-1 text-xs text-surface-300 focus:border-primary-500 focus:outline-none [color-scheme:dark]"
                        />
                      </div>
                    ))}
                  </div>
                ));
              })() : (
                <div className="px-5 py-6 text-center text-sm text-surface-400">{myTasks === null ? 'Loading...' : 'No checklist tasks assigned to you.'}</div>
              )}
            </div>
          </Panel>
        </section>
      )}

      {(watchingAlerts === null || watchingCases === null || watchingAlerts.length > 0 || watchingCases.length > 0) && (
        <section aria-label="Watching">
          <Panel title="Watching" description="Alerts and investigations you follow across the org." action={<Link to="/watchlist" className="text-xs font-semibold text-primary-300 hover:text-primary-200">View watchlist</Link>}>
            <div className="grid gap-0 divide-y divide-surface-800 md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="divide-y divide-surface-800">
                {(watchingAlerts ?? []).length > 0 ? (watchingAlerts ?? []).map(alert => (
                  <Link key={alert.id} to={`/alerts?alert=${alert.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                    <StatusBadge tone={alert.severity === 'critical' ? 'danger' : alert.severity === 'high' ? 'warning' : 'neutral'}>{alert.severity}</StatusBadge>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{alert.title}</p><p className="mt-0.5 truncate font-mono text-[11px] text-surface-500">{alert.cve_id || alert.source}</p></div>
                    <span className="ml-auto text-xs text-surface-500">{alert.status}</span>
                  </Link>
                )) : (
                  <div className="px-5 py-6 text-center text-sm text-surface-400">{watchingAlerts === null ? 'Loading...' : 'No watched alerts.'}</div>
                )}
              </div>
              <div className="divide-y divide-surface-800">
                {(watchingCases ?? []).length > 0 ? (watchingCases ?? []).map(c => (
                  <Link key={c.id} to={`/cases/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                    <StatusBadge tone={c.severity === 'critical' ? 'danger' : c.severity === 'high' ? 'warning' : 'neutral'}>{c.severity}</StatusBadge>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{c.title}</p><p className="mt-0.5 truncate text-[11px] text-surface-500">Investigation #{c.id}{c.due_date ? ` · due ${c.due_date}` : ''}</p></div>
                    <span className="ml-auto text-xs text-surface-500">{c.status}</span>
                  </Link>
                )) : (
                  <div className="px-5 py-6 text-center text-sm text-surface-400">{watchingCases === null ? 'Loading...' : 'No watched investigations.'}</div>
                )}
              </div>
            </div>
          </Panel>
        </section>
      )}

      {(incidents === null || incidents.length > 0) && (
        <section aria-label="Active incidents">
          <Panel title="Active incidents" description="Correlated alert groups hitting the same asset." action={<Link to="/incidents" className="text-xs font-semibold text-primary-300 hover:text-primary-200">View incidents</Link>}>
            <div className="divide-y divide-surface-800">
              {(incidents ?? []).length > 0 ? (incidents ?? []).slice(0, 4).map(incident => (
                <Link key={incident.asset_id} to="/incidents" className="flex items-center gap-3 px-5 py-3 hover:bg-surface-800/45">
                  <StatusBadge tone={incident.max_severity === 'critical' ? 'danger' : incident.max_severity === 'high' ? 'warning' : 'neutral'}>{incident.max_severity}</StatusBadge>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-surface-100">{incident.asset_name}</p><p className="mt-0.5 truncate text-[11px] text-surface-500">{incident.alert_count} active alerts{incident.blast_radius > 0 ? ` · blast radius ${incident.blast_radius}` : ''}</p></div>
                </Link>
              )) : (
                <div className="px-5 py-6 text-center text-sm text-surface-400">Loading...</div>
              )}
            </div>
          </Panel>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Severity distribution" description="Current alert inventory by operational severity. Select a slice to filter the alert list."><div className="p-4"><SeverityBreakdown stats={stats} onSelect={(severity) => navigate(`/alerts?severity=${severity}`)} /></div></Panel>
        <Panel title={`Alert activity · ${timeline && timeline.length > 0 ? timeline.length : 7} days`} description="Daily volume grouped by severity."><div className="p-4"><AlertTrend alerts={alerts ?? []} timeline={timeline} /></div></Panel>
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
