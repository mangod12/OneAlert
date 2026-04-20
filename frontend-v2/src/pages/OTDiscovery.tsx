import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import type { DiscoveredDevice, OTSummary, ProtocolData } from '../api/types';
import { Network, Wifi, AlertTriangle, Link2 } from 'lucide-react';
import clsx from 'clsx';

export function OTDiscovery() {
  const [summary, setSummary] = useState<OTSummary | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [protocols, setProtocols] = useState<ProtocolData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, devicesRes, protocolsRes] = await Promise.all([
          apiClient.get('/ot/summary'),
          apiClient.get('/ot/discovered-devices', { params: { size: 20 } }),
          apiClient.get('/ot/devices-by-protocol'),
        ]);
        setSummary(summaryRes.data);
        setDevices(devicesRes.data.devices || []);
        setProtocols(protocolsRes.data.protocols || []);
      } catch (err) {
        console.error('Failed to load OT data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handlePromote = async (deviceId: number) => {
    await apiClient.post(`/ot/discovered-devices/${deviceId}/promote-to-asset`);
    // Refresh
    const res = await apiClient.get('/ot/discovered-devices', { params: { size: 20 } });
    setDevices(res.data.devices || []);
  };

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
        <h1 className="text-2xl font-bold text-white">OT Discovery</h1>
        <p className="text-surface-400 mt-1">Network device discovery and correlation</p>
      </div>

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
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700">
          <h3 className="text-lg font-semibold text-white">Discovered Devices</h3>
        </div>
        {devices.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            No devices discovered yet. Deploy a network sensor to start scanning.
          </div>
        ) : (
          <table className="w-full text-sm">
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
                      <button
                        onClick={() => handlePromote(device.id)}
                        className="text-xs text-primary-400 hover:text-primary-300 font-medium"
                      >
                        Promote to Asset
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
