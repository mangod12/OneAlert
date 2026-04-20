import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import type { AlertStats, OTSummary } from '../api/types';
import { KPICard } from '../components/KPICard';
import { SeverityBreakdown } from '../components/charts/SeverityBreakdown';
import { AlertTrend } from '../components/charts/AlertTrend';
import { RiskHeatmap } from '../components/charts/RiskHeatmap';
import { ShieldAlert, Server, Activity, AlertTriangle } from 'lucide-react';

export function Dashboard() {
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [otSummary, setOTSummary] = useState<OTSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, otRes] = await Promise.all([
          apiClient.get('/alerts/stats/overview'),
          apiClient.get('/ot/summary'),
        ]);
        setStats(statsRes.data);
        setOTSummary(otRes.data);
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-surface-400 mt-1">Security posture overview</p>
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
          value={(otSummary?.managed_ot_assets ?? 0) + (stats?.total_alerts ? 1 : 0)}
          icon={Server}
          color="success"
        />
        <KPICard
          title="OT Devices Discovered"
          value={otSummary?.discovered_ot_devices ?? 0}
          icon={Activity}
          color="warning"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Severity Breakdown</h3>
          <SeverityBreakdown stats={stats} />
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Alert Trend (7 days)</h3>
          <AlertTrend />
        </div>
      </div>

      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Risk Heatmap</h3>
        <RiskHeatmap />
      </div>
    </div>
  );
}
