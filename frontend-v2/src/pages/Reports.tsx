import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BriefcaseMedical, Clock, Download, ShieldAlert, ShieldCheck, Siren, Timer, Users } from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { KPICard } from '../components/KPICard';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones } from '../components/ui/tones';
import { formatDuration } from '../utils/formatDuration';

interface PostureReport {
  days: number;
  generated_at: string;
  alerts: {
    opened: number;
    acknowledged: number;
    resolved: number;
    by_severity: Record<'critical' | 'high' | 'medium' | 'low', number>;
    mtta_seconds: number | null;
    mttr_seconds: number | null;
  };
  incidents: {
    active: number;
    critical: number;
    top_assets: Array<{ asset_id: number; asset_name: string; alert_count: number; max_severity: string }>;
  };
  cases: { open: number; in_progress: number; closed: number; opened: number };
}

interface SlaBucket {
  due: number;
  met: number;
  breached: number;
  upcoming: number;
  attainment_pct: number | null;
  by_severity: Record<'critical' | 'high' | 'medium' | 'low', { due: number; met: number; breached: number }>;
}

interface SlaReport {
  days: number;
  alerts: SlaBucket;
  cases: SlaBucket;
}

interface WorkloadMember {
  user_id: number;
  email: string;
  full_name: string | null;
  alerts_open: number;
  alerts_overdue: number;
  cases_open: number;
  cases_overdue: number;
  tasks_open: number;
}

interface TeamWorkload {
  generated_at: string;
  members: WorkloadMember[];
}

interface TrendPoint {
  date: string;
  opened: number;
  resolved: number;
}

interface AlertTrend {
  days: number;
  series: TrendPoint[];
}

function slaCsv(sla: SlaReport): string {
  const rows = [['scope', 'severity', 'due', 'met', 'breached', 'attainment_pct']];
  for (const scope of ['alerts', 'cases'] as const) {
    const bucket = sla[scope];
    rows.push([
      scope, 'all', String(bucket.due), String(bucket.met), String(bucket.breached),
      bucket.attainment_pct === null ? '' : String(bucket.attainment_pct),
    ]);
    for (const sev of SEVERITIES) {
      const s = bucket.by_severity[sev];
      if (s.due > 0) rows.push([scope, sev, String(s.due), String(s.met), String(s.breached), '']);
    }
  }
  return rows.map((r) => r.join(',')).join('\n');
}

const WINDOWS = [7, 30, 90];
const SEVERITIES: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low'];

export function Reports() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<PostureReport | null>(null);
  const [sla, setSla] = useState<SlaReport | null>(null);
  const [workload, setWorkload] = useState<TeamWorkload | null>(null);
  const [trend, setTrend] = useState<AlertTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (window: number) => {
    setLoading(true);
    setError(null);
    try {
      const [postureRes, slaRes, workloadRes, trendRes] = await Promise.all([
        apiClient.get('/reports/posture', { params: { days: window } }),
        apiClient.get('/reports/sla', { params: { days: window } }),
        apiClient.get('/reports/team-workload'),
        apiClient.get('/reports/alert-trend', { params: { days: window } }),
      ]);
      setReport(postureRes.data);
      setSla(slaRes.data);
      setWorkload(workloadRes.data);
      setTrend(trendRes.data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the posture report.'));
      setReport(null);
      setSla(null);
      setWorkload(null);
      setTrend(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchReport(days); }, [days, fetchReport]);

  const exportSlaCsv = () => {
    if (!sla) return;
    const blob = new Blob([slaCsv(sla)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sla-compliance-${sla.days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxSeverityCount = report
    ? Math.max(1, ...SEVERITIES.map((sev) => report.alerts.by_severity[sev]))
    : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command"
        title="Posture report"
        description="Security posture over a trailing window: alert volume and response speed, active incidents, and investigation throughput."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-surface-700 bg-surface-900 p-1" role="group" aria-label="Report window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDays(w)}
                aria-pressed={days === w}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === w ? 'bg-primary-500/20 text-primary-200' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {w} days
              </button>
            ))}
          </div>
        }
      />

      {loading && <LoadingSurface label="Building posture report" />}
      {!loading && error && (
        <ErrorState title="Report unavailable" description={error} action={<RetryButton onClick={() => void fetchReport(days)} />} />
      )}

      {!loading && !error && report && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard title="Alerts opened" value={report.alerts.opened} icon={ShieldAlert} color="info" detail={`${report.alerts.by_severity.critical} critical · ${report.days}d window`} />
            <KPICard title="Mean time to acknowledge" value={formatDuration(report.alerts.mtta_seconds)} icon={Clock} color="warning" detail={`${report.alerts.acknowledged} acknowledged · ${report.days}d`} />
            <KPICard title="Mean time to resolve" value={formatDuration(report.alerts.mttr_seconds)} icon={Timer} color="success" detail={`${report.alerts.resolved} resolved · ${report.days}d`} />
            <KPICard title="Active incidents" value={report.incidents.active} icon={Siren} color="danger" detail={`${report.incidents.critical} at critical severity`} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Alert volume by severity" description={`Alerts opened in the last ${report.days} days.`}>
              <div className="space-y-3 p-4">
                {SEVERITIES.map((sev) => {
                  const count = report.alerts.by_severity[sev];
                  return (
                    <div key={sev} className="flex items-center gap-3">
                      <span className="w-16 text-xs font-medium capitalize text-surface-300">{sev}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-800">
                        <div
                          className={`h-full rounded-full ${sev === 'critical' ? 'bg-danger' : sev === 'high' ? 'bg-warning' : sev === 'medium' ? 'bg-primary-400' : 'bg-surface-500'}`}
                          style={{ width: `${(count / maxSeverityCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-surface-200">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Investigations" description="Current workload and throughput in the window.">
              <div className="grid grid-cols-2 gap-3 p-4">
                <div className="rounded-lg border border-surface-800 p-3">
                  <p className="text-2xl font-bold text-surface-50">{report.cases.open}</p>
                  <p className="mt-1 text-xs text-surface-400">Open now</p>
                </div>
                <div className="rounded-lg border border-surface-800 p-3">
                  <p className="text-2xl font-bold text-surface-50">{report.cases.in_progress}</p>
                  <p className="mt-1 text-xs text-surface-400">In progress</p>
                </div>
                <div className="rounded-lg border border-surface-800 p-3">
                  <p className="text-2xl font-bold text-surface-50">{report.cases.opened}</p>
                  <p className="mt-1 text-xs text-surface-400">Opened in {report.days}d</p>
                </div>
                <div className="rounded-lg border border-surface-800 p-3">
                  <p className="text-2xl font-bold text-surface-50">{report.cases.closed}</p>
                  <p className="mt-1 text-xs text-surface-400">Closed overall</p>
                </div>
              </div>
              <div className="border-t border-surface-800 px-4 py-3">
                <Link to="/cases" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-400 hover:text-primary-300">
                  <BriefcaseMedical className="h-3.5 w-3.5" /> Open investigations
                </Link>
              </div>
            </Panel>
          </div>

          {trend && trend.series.length > 0 && (
            <Panel
              title="Alert volume trend"
              description={`Alerts opened vs resolved each day over the trailing ${trend.days} days.`}
            >
              <div className="p-4" data-testid="alert-trend">
                {(() => {
                  const maxCount = Math.max(1, ...trend.series.map((p) => Math.max(p.opened, p.resolved)));
                  const totalOpened = trend.series.reduce((sum, p) => sum + p.opened, 0);
                  const totalResolved = trend.series.reduce((sum, p) => sum + p.resolved, 0);
                  return (
                    <>
                      <div className="flex h-28 items-end gap-px">
                        {trend.series.map((p) => (
                          <div
                            key={p.date}
                            className="flex h-full flex-1 items-end justify-center gap-px"
                            title={`${p.date}: ${p.opened} opened, ${p.resolved} resolved`}
                          >
                            <div
                              className="w-1/2 rounded-t-sm bg-primary-500"
                              style={{ height: `${(p.opened / maxCount) * 100}%`, minHeight: p.opened > 0 ? '2px' : 0 }}
                            />
                            <div
                              className="w-1/2 rounded-t-sm bg-success"
                              style={{ height: `${(p.resolved / maxCount) * 100}%`, minHeight: p.resolved > 0 ? '2px' : 0 }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-surface-500">
                        <span>{trend.series[0].date}</span>
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-sm bg-primary-500" />
                            {totalOpened} opened
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-sm bg-success" />
                            {totalResolved} resolved
                          </span>
                        </div>
                        <span>{trend.series[trend.series.length - 1].date}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Panel>
          )}

          {sla && (
            <Panel
              title="SLA compliance"
              description={`Items whose due date fell inside the last ${sla.days} days: met when resolved or closed by the due date, breached otherwise.`}
            >
              <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                {([['Alerts', sla.alerts], ['Investigations', sla.cases]] as Array<[string, SlaBucket]>).map(([label, bucket]) => (
                  <div key={label} className="rounded-lg border border-surface-800 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
                        <ShieldCheck className="h-4 w-4 text-primary-400" aria-hidden="true" />
                        {label}
                      </h3>
                      {bucket.due > 0 ? (
                        <span className={`text-2xl font-bold ${bucket.attainment_pct !== null && bucket.attainment_pct >= 90 ? 'text-success' : bucket.attainment_pct !== null && bucket.attainment_pct >= 70 ? 'text-warning' : 'text-danger'}`}>
                          {bucket.attainment_pct}%
                        </span>
                      ) : (
                        <span className="text-sm text-surface-500">No due dates in window</span>
                      )}
                    </div>
                    {bucket.due > 0 && (
                      <>
                        <p className="mt-1 text-xs text-surface-400">
                          {bucket.met} met · {bucket.breached} breached · {bucket.upcoming} upcoming
                        </p>
                        <div className="mt-3 space-y-2">
                          {SEVERITIES.map((sev) => {
                            const s = bucket.by_severity[sev];
                            if (s.due === 0) return null;
                            return (
                              <div key={sev} className="flex items-center gap-3 text-xs">
                                <span className="w-16 font-medium capitalize text-surface-300">{sev}</span>
                                <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-surface-800">
                                  <div className="h-full bg-success" style={{ width: `${(s.met / s.due) * 100}%` }} />
                                  <div className="h-full bg-danger" style={{ width: `${(s.breached / s.due) * 100}%` }} />
                                </div>
                                <span className="w-20 text-right text-surface-400">{s.met}/{s.due} met</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t border-surface-800 px-4 py-3">
                <button
                  type="button"
                  onClick={exportSlaCsv}
                  className="flex items-center gap-2 rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-200 transition-colors hover:bg-surface-700"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export SLA CSV
                </button>
              </div>
            </Panel>
          )}

          {workload && workload.members.length > 0 && (
            <Panel
              title="Team workload"
              description="Open assigned work across your organization: alerts past their triage due date, investigations past their SLA, and open checklist tasks."
            >
              <ul className="divide-y divide-surface-800" data-testid="team-workload">
                {workload.members.map((member) => {
                  const totalOpen = member.alerts_open + member.cases_open + member.tasks_open;
                  const totalOverdue = member.alerts_overdue + member.cases_overdue;
                  return (
                    <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Users className="h-4 w-4 shrink-0 text-surface-400" aria-hidden="true" />
                        <span className="truncate font-medium text-surface-100">{member.full_name || member.email}</span>
                        {member.full_name && <span className="truncate text-xs text-surface-500">{member.email}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-surface-300">
                        {totalOpen === 0 ? (
                          <span className="text-surface-500">No open work</span>
                        ) : (
                          <>
                            <span>{member.alerts_open} open {member.alerts_open === 1 ? 'alert' : 'alerts'}</span>
                            <span>{member.cases_open} open {member.cases_open === 1 ? 'investigation' : 'investigations'}</span>
                            <span>{member.tasks_open} open {member.tasks_open === 1 ? 'task' : 'tasks'}</span>
                            {totalOverdue > 0 && (
                              <span className="font-medium text-danger">{totalOverdue} overdue</span>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <Panel
            title="Highest-risk assets"
            description="Assets with the most active alerts right now, ranked by severity then volume."
          >
            {report.incidents.top_assets.length === 0 ? (
              <p className="px-4 py-6 text-sm text-surface-400">No active incidents. No asset has two or more active alerts.</p>
            ) : (
              <ul className="divide-y divide-surface-800">
                {report.incidents.top_assets.map((asset) => (
                  <li key={asset.asset_id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Siren className="h-4 w-4 shrink-0 text-surface-400" />
                      <span className="truncate font-medium text-surface-100">{asset.asset_name}</span>
                      <StatusBadge tone={alertSeverityTones[asset.max_severity] ?? 'neutral'}>{asset.max_severity}</StatusBadge>
                    </div>
                    <span className="shrink-0 text-xs text-surface-400">{asset.alert_count} active alerts</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-surface-800 px-4 py-3">
              <Link to="/incidents" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-400 hover:text-primary-300">
                <Siren className="h-3.5 w-3.5" /> Open incidents
              </Link>
            </div>
          </Panel>

          <p className="text-xs text-surface-500">
            Generated {new Date(report.generated_at).toLocaleString()} · trailing {report.days}-day window
          </p>
        </>
      )}
    </div>
  );
}
