import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import type { AlertStats, Alert } from '../api/types';
import { KPICard } from '../components/KPICard';
import { SeverityBreakdown } from '../components/charts/SeverityBreakdown';
import { AlertTrend } from '../components/charts/AlertTrend';
import { RiskHeatmap } from '../components/charts/RiskHeatmap';
import {
  Activity,
  AlertTriangle,
  Bot,
  Crosshair,
  FileClock,
  Network,
  Radar,
  Server,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

export function Dashboard() {
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalDiscovered, setTotalDiscovered] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, assetsRes, devicesRes, alertsRes] = await Promise.all([
          apiClient.get('/alerts/stats/overview'),
          apiClient.get('/assets/', { params: { size: 1 } }),
          apiClient.get('/ot/discovered-devices', { params: { size: 1 } }),
          apiClient.get('/alerts/', { params: { size: 50 } }),
        ]);
        setStats(statsRes.data);
        setTotalAssets(assetsRes.data.total ?? 0);
        setTotalDiscovered(devicesRes.data.total ?? 0);
        setAlerts(alertsRes.data.alerts ?? []);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  const totalAlerts = stats?.total_alerts ?? 0;
  const criticalAlerts = stats?.critical_alerts ?? 0;
  const highAlerts = stats?.high_alerts ?? 0;
  const unresolvedAlerts = (stats?.pending_alerts ?? 0) + (stats?.acknowledged_alerts ?? 0);
  const agentConfidence = totalAlerts > 0
    ? Math.max(54, Math.round(((totalAlerts - criticalAlerts) / totalAlerts) * 100))
    : 96;

  const agentLanes = [
    { label: 'Detect', value: totalDiscovered + totalAssets, status: 'online', icon: Radar },
    { label: 'Triage', value: unresolvedAlerts, status: unresolvedAlerts > 0 ? 'queued' : 'clear', icon: Bot },
    { label: 'Hunt', value: highAlerts + criticalAlerts, status: highAlerts + criticalAlerts > 0 ? 'active' : 'standby', icon: Crosshair },
    { label: 'Respond', value: 0, status: 'approval gated', icon: ShieldCheck },
  ];

  const readinessItems = [
    { label: 'Local model route', value: 'Planned', tone: 'text-cyan-300' },
    { label: 'Run ledger', value: 'Design ready', tone: 'text-emerald-300' },
    { label: 'Telemetry ingest', value: 'Sensor API live', tone: 'text-amber-300' },
    { label: 'Offensive mode', value: 'Dry-run only', tone: 'text-rose-300' },
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">OneAlert Command</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Security Operations</h1>
          <p className="mt-2 max-w-3xl text-sm text-surface-400">
            OT asset risk, vulnerability intelligence, topology signals, and governed agent readiness.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[560px]">
          {readinessItems.map((item) => (
            <div key={item.label} className="border border-surface-800 bg-surface-900/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-surface-500">{item.label}</p>
              <p className={`mt-1 text-sm font-semibold ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Alerts"
          value={stats?.total_alerts ?? 0}
          icon={ShieldAlert}
          color="info"
        />
        <KPICard
          title="Critical"
          value={stats?.critical_alerts ?? 0}
          icon={AlertTriangle}
          color="danger"
        />
        <KPICard
          title="Assets Monitored"
          value={totalAssets}
          icon={Server}
          color="success"
        />
        <KPICard
          title="Devices Discovered"
          value={totalDiscovered}
          icon={Activity}
          color="warning"
        />
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="border border-surface-800 bg-surface-900/70 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">AI Security Agent Readiness</h2>
              <p className="mt-1 text-sm text-surface-400">Detect, triage, hunt, respond, and validate lanes.</p>
            </div>
            <div className="flex items-center gap-2 border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              <Bot className="h-4 w-4" />
              {agentConfidence}% posture confidence
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
            {agentLanes.map((lane) => (
              <div key={lane.label} className="border border-surface-800 bg-surface-950/70 p-4">
                <div className="flex items-center justify-between">
                  <lane.icon className="h-5 w-5 text-cyan-300" />
                  <span className="text-xs font-medium uppercase text-surface-500">{lane.status}</span>
                </div>
                <p className="mt-4 text-2xl font-bold text-white">{lane.value}</p>
                <p className="mt-1 text-sm text-surface-400">{lane.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="flex items-center gap-3 border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              Approval gates enabled
            </div>
            <div className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <Workflow className="h-4 w-4" />
              Agent ledger planned
            </div>
            <div className="flex items-center gap-3 border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <Crosshair className="h-4 w-4" />
              Offensive actions scoped
            </div>
          </div>
        </div>

        <div className="border border-surface-800 bg-surface-900/70 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Telemetry Health</h2>
            <Activity className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="mt-5 space-y-4">
            {[
              { label: 'Managed assets', value: totalAssets, width: Math.min(100, totalAssets * 8), tone: 'bg-cyan-400' },
              { label: 'Discovered devices', value: totalDiscovered, width: Math.min(100, totalDiscovered * 10), tone: 'bg-emerald-400' },
              { label: 'Open investigations', value: unresolvedAlerts, width: Math.min(100, unresolvedAlerts * 12), tone: 'bg-amber-400' },
              { label: 'Critical exposure', value: criticalAlerts, width: Math.min(100, criticalAlerts * 18), tone: 'bg-rose-400' },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-surface-400">{item.label}</span>
                  <span className="font-semibold text-white">{item.value}</span>
                </div>
                <div className="mt-2 h-2 bg-surface-800">
                  <div className={`h-full ${item.tone}`} style={{ width: `${Math.max(8, item.width)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-900/70 border border-surface-800 p-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-cyan-300" />
            <h3 className="text-lg font-semibold text-white">Severity Breakdown</h3>
          </div>
          <SeverityBreakdown stats={stats} />
        </div>
        <div className="bg-surface-900/70 border border-surface-800 p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileClock className="h-5 w-5 text-amber-300" />
            <h3 className="text-lg font-semibold text-white">Alert Trend (7 days)</h3>
          </div>
          <AlertTrend alerts={alerts} />
        </div>
      </div>

      <div className="bg-surface-900/70 border border-surface-800 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Network className="h-5 w-5 text-emerald-300" />
          <h3 className="text-lg font-semibold text-white">Risk Heatmap</h3>
        </div>
        <RiskHeatmap />
      </div>
    </div>
  );
}
