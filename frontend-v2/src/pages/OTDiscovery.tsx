import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import type { DiscoveredDevice, OTSummary, ProtocolData } from '../api/types';
import { Network, Wifi, AlertTriangle, Link2 } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/Toast';

export function OTDiscovery() {
  const [summary, setSummary] = useState<OTSummary | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [protocols, setProtocols] = useState<ProtocolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingDevices, setPendingDevices] = useState<Set<number>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    setErrors([]);
    const [summaryResult, devicesResult, protocolsResult] = await Promise.allSettled([
      apiClient.get('/ot/summary'),
      apiClient.get('/ot/discovered-devices', { params: { size: 20 } }),
      apiClient.get('/ot/devices-by-protocol'),
    ]);
    const nextErrors: string[] = [];
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value.data);
    else nextErrors.push(getApiErrorMessage(summaryResult.reason, 'OT summary is unavailable'));
    if (devicesResult.status === 'fulfilled') setDevices(devicesResult.value.data.devices || []);
    else nextErrors.push(getApiErrorMessage(devicesResult.reason, 'Discovered devices are unavailable'));
    if (protocolsResult.status === 'fulfilled') setProtocols(protocolsResult.value.data.protocols || []);
    else nextErrors.push(getApiErrorMessage(protocolsResult.reason, 'Protocol telemetry is unavailable'));
    setErrors(nextErrors);
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const handlePromote = async (deviceId: number) => {
    if (pendingDevices.has(deviceId)) return;
    setPendingDevices(current => new Set(current).add(deviceId));
    try {
      await apiClient.post(`/ot/discovered-devices/${deviceId}/promote-to-asset`);
      const res = await apiClient.get('/ot/discovered-devices', { params: { size: 20 } });
      setDevices(res.data.devices || []);
      toast('Device promoted to the managed asset inventory.', 'success');
    } catch (error: unknown) {
      toast(getApiErrorMessage(error, 'Device could not be promoted.'), 'error');
    } finally {
      setPendingDevices(current => { const next = new Set(current); next.delete(deviceId); return next; });
    }
  };

  if (loading) {
    return <LoadingSurface rows={6} label="Loading OT discovery" />;
  }

  if (!summary && devices.length === 0 && protocols.length === 0 && errors.length > 0) return <ErrorState title="OT discovery unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchData()} />} />;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Observe" title="OT Discovery" description="Passive network device discovery, protocol visibility, and inventory correlation." />
      {errors.length > 0 && <DegradedBanner messages={errors} onRetry={() => void fetchData()} />}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <Network className="w-5 h-5 text-primary-400 mb-2" />
          <p className="text-2xl font-bold text-white">{summary?.managed_ot_assets ?? 0}</p>
          <p className="text-xs text-surface-400">Managed OT Assets</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <Wifi className="w-5 h-5 text-info mb-2" />
          <p className="text-2xl font-bold text-white">{summary?.discovered_ot_devices ?? 0}</p>
          <p className="text-xs text-surface-400">Discovered Devices</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-danger mb-2" />
          <p className="text-2xl font-bold text-white">{summary?.high_risk_devices ?? 0}</p>
          <p className="text-xs text-surface-400">High Risk</p>
        </div>
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-4">
          <Link2 className="w-5 h-5 text-warning mb-2" />
          <p className="text-2xl font-bold text-white">{summary?.uncorrelated_devices ?? 0}</p>
          <p className="text-xs text-surface-400">Uncorrelated</p>
        </div>
      </div>

      {/* Protocol Breakdown */}
      {protocols.length > 0 && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Protocols Detected</h3>
          <div className="flex flex-wrap gap-3">
            {protocols.map((p) => (
              <div key={p.protocol} className="px-3 py-2 bg-surface-700/50 border border-surface-600 rounded-lg">
                <span className="text-sm font-medium text-white">{p.protocol}</span>
                <span className="ml-2 text-xs text-surface-400">({p.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovered Devices Table */}
      <div className="oa-panel overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700">
          <h3 className="text-lg font-semibold text-white">Discovered Devices</h3>
        </div>
        {devices.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            No devices discovered yet. Deploy a network sensor to start scanning.
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400">
                <th className="px-4 py-3 text-left">IP Address</th>
                <th className="px-4 py-3 text-left">Hostname</th>
                <th className="px-4 py-3 text-left">Manufacturer</th>
                <th className="px-4 py-3 text-left">Risk</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} className="border-b border-surface-700/50 hover:bg-surface-800 transition-colors">
                  <td className="px-4 py-3 font-mono text-surface-200">{device.ip_address}</td>
                  <td className="px-4 py-3 text-surface-300">{device.hostname || '-'}</td>
                  <td className="px-4 py-3 text-surface-300">{device.manufacturer || 'Unknown'}</td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      'text-xs font-medium',
                      device.risk_score >= 70 ? 'text-danger' :
                      device.risk_score >= 40 ? 'text-warning' : 'text-success'
                    )}>
                      {device.risk_score.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {device.is_correlated ? (
                      <span className="text-xs text-success">Correlated</span>
                    ) : (
                      <span className="text-xs text-surface-500">Unmatched</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!device.is_correlated && (
                      <button disabled={pendingDevices.has(device.id)}
                        onClick={() => handlePromote(device.id)}
                        className="text-xs text-primary-400 hover:text-primary-300 font-medium"
                      >
                        {pendingDevices.has(device.id) ? 'Promoting…' : 'Promote to asset'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
