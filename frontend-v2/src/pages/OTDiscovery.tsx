import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import type { DiscoveredDevice, OTSummary, ProtocolData } from '../api/types';
import { Network, Wifi, AlertTriangle, Link2, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { toast } from '../components/Toast';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface NetworkSensor {
  id: number;
  name: string;
  sensor_type: string;
  location: string | null;
  network_segment: string | null;
  enabled: boolean | null;
  last_heartbeat: string | null;
  last_discovery_count: number;
}

export function OTDiscovery() {
  const [summary, setSummary] = useState<OTSummary | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [protocols, setProtocols] = useState<ProtocolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingDevices, setPendingDevices] = useState<Set<number>>(new Set());
  const [sensors, setSensors] = useState<NetworkSensor[]>([]);
  const [showSensorForm, setShowSensorForm] = useState(false);
  const [sensorForm, setSensorForm] = useState({ name: '', sensor_type: 'passive', location: '', network_segment: '' });
  const [savingSensor, setSavingSensor] = useState(false);
  const [pendingSensorDelete, setPendingSensorDelete] = useState<NetworkSensor | null>(null);
  const [deletingSensor, setDeletingSensor] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    setErrors([]);
    const [summaryResult, devicesResult, protocolsResult, sensorsResult] = await Promise.allSettled([
      apiClient.get('/ot/summary'),
      apiClient.get('/ot/discovered-devices', { params: { size: 20 } }),
      apiClient.get('/ot/devices-by-protocol'),
      apiClient.get('/ot/sensors'),
    ]);
    const nextErrors: string[] = [];
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value.data);
    else nextErrors.push(getApiErrorMessage(summaryResult.reason, 'OT summary is unavailable'));
    if (devicesResult.status === 'fulfilled') setDevices(devicesResult.value.data.devices || []);
    else nextErrors.push(getApiErrorMessage(devicesResult.reason, 'Discovered devices are unavailable'));
    if (protocolsResult.status === 'fulfilled') setProtocols(protocolsResult.value.data.protocols || []);
    else nextErrors.push(getApiErrorMessage(protocolsResult.reason, 'Protocol telemetry is unavailable'));
    if (sensorsResult.status === 'fulfilled') setSensors(sensorsResult.value.data || []);
    else nextErrors.push(getApiErrorMessage(sensorsResult.reason, 'Sensors are unavailable'));
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

  const handleCreateSensor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSensor) return;
    setSavingSensor(true);
    try {
      await apiClient.post('/ot/sensors', {
        name: sensorForm.name,
        sensor_type: sensorForm.sensor_type,
        location: sensorForm.location || null,
        network_segment: sensorForm.network_segment || null,
      });
      setShowSensorForm(false);
      setSensorForm({ name: '', sensor_type: 'passive', location: '', network_segment: '' });
      const res = await apiClient.get('/ot/sensors');
      setSensors(res.data || []);
      toast('Sensor registered.', 'success');
    } catch (error: unknown) {
      toast(getApiErrorMessage(error, 'Sensor could not be registered.'), 'error');
    } finally {
      setSavingSensor(false);
    }
  };

  const handleToggleSensor = async (sensor: NetworkSensor) => {
    if (togglingIds.has(sensor.id)) return;
    setTogglingIds(current => new Set(current).add(sensor.id));
    try {
      await apiClient.patch(`/ot/sensors/${sensor.id}`, { enabled: !sensor.enabled });
      setSensors(current => current.map(item => item.id === sensor.id ? { ...item, enabled: !sensor.enabled } : item));
    } catch (error: unknown) {
      toast(getApiErrorMessage(error, 'Sensor could not be updated.'), 'error');
    } finally {
      setTogglingIds(current => { const next = new Set(current); next.delete(sensor.id); return next; });
    }
  };

  const handleDeleteSensor = async (sensor: NetworkSensor) => {
    if (deletingSensor) return;
    setDeletingSensor(true);
    try {
      await apiClient.delete(`/ot/sensors/${sensor.id}`);
      setPendingSensorDelete(null);
      setSensors(current => current.filter(item => item.id !== sensor.id));
      toast('Sensor removed.', 'success');
    } catch (error: unknown) {
      toast(getApiErrorMessage(error, 'Sensor could not be removed.'), 'error');
    } finally {
      setDeletingSensor(false);
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

      {/* Sensors */}
      <div className="oa-panel rounded-md p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-50">Sensors</h2>
          <button
            onClick={() => setShowSensorForm(current => !current)}
            className="flex min-h-8 items-center gap-1.5 rounded-md border border-surface-700 px-2.5 text-xs font-medium text-surface-200 hover:bg-surface-800"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Register sensor
          </button>
        </div>

        {showSensorForm && (
          <form onSubmit={handleCreateSensor} className="mb-4 grid grid-cols-1 gap-2 rounded-md border border-surface-700 bg-surface-800/50 p-3 md:grid-cols-4">
            <input
              aria-label="Sensor name"
              placeholder="Name"
              value={sensorForm.name}
              onChange={(e) => setSensorForm({ ...sensorForm, name: e.target.value })}
              required
              className="rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              aria-label="Sensor type"
              value={sensorForm.sensor_type}
              onChange={(e) => setSensorForm({ ...sensorForm, sensor_type: e.target.value })}
              className="rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="passive">Passive</option>
              <option value="active">Active</option>
              <option value="agent">Agent</option>
            </select>
            <input
              aria-label="Location"
              placeholder="Location (optional)"
              value={sensorForm.location}
              onChange={(e) => setSensorForm({ ...sensorForm, location: e.target.value })}
              className="rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="flex gap-2">
              <input
                aria-label="Network segment"
                placeholder="Segment (optional)"
                value={sensorForm.network_segment}
                onChange={(e) => setSensorForm({ ...sensorForm, network_segment: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                disabled={savingSensor}
                className="shrink-0 rounded-md bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-40"
              >
                {savingSensor ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {sensors.length === 0 ? (
          <p className="text-sm text-surface-500">No sensors registered. Register one to start passive discovery.</p>
        ) : (
          <div className="space-y-2">
            {sensors.map(sensor => (
              <div key={sensor.id} className="flex items-center justify-between rounded-md border border-surface-700 bg-surface-800/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-surface-100">{sensor.name}</span>
                    <StatusBadge tone={sensor.enabled ? 'success' : 'neutral'}>{sensor.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
                  </div>
                  <p className="text-xs text-surface-500">
                    {sensor.sensor_type}
                    {sensor.location && ` · ${sensor.location}`}
                    {sensor.network_segment && ` · ${sensor.network_segment}`}
                    {sensor.last_heartbeat
                      ? ` · last heartbeat ${new Date(sensor.last_heartbeat).toLocaleString()}`
                      : ' · no heartbeat yet'}
                  </p>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void handleToggleSensor(sensor)}
                    disabled={togglingIds.has(sensor.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-surface-300 hover:bg-surface-700 disabled:opacity-40"
                  >
                    {sensor.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => setPendingSensorDelete(sensor)}
                    aria-label={`Delete sensor ${sensor.name}`}
                    className="p-1.5 text-surface-500 hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingSensorDelete && (
        <ConfirmDialog
          title="Delete sensor?"
          description={`${pendingSensorDelete.name} will stop reporting and its registration will be removed. Devices it already discovered stay in the inventory.`}
          confirmLabel="Delete sensor"
          tone="danger"
          busy={deletingSensor}
          onCancel={() => { if (!deletingSensor) setPendingSensorDelete(null); }}
          onConfirm={() => { void handleDeleteSensor(pendingSensorDelete); }}
        />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="oa-panel rounded-md p-4">
          <Network className="w-5 h-5 text-primary-400 mb-2" />
          <p className="text-2xl font-bold text-surface-50">{summary?.managed_ot_assets ?? 0}</p>
          <p className="text-xs text-surface-400">Managed OT Assets</p>
        </div>
        <div className="oa-panel rounded-md p-4">
          <Wifi className="w-5 h-5 text-info mb-2" />
          <p className="text-2xl font-bold text-surface-50">{summary?.discovered_ot_devices ?? 0}</p>
          <p className="text-xs text-surface-400">Discovered Devices</p>
        </div>
        <div className="oa-panel rounded-md p-4">
          <AlertTriangle className="w-5 h-5 text-danger mb-2" />
          <p className="text-2xl font-bold text-surface-50">{summary?.high_risk_devices ?? 0}</p>
          <p className="text-xs text-surface-400">High Risk</p>
        </div>
        <div className="oa-panel rounded-md p-4">
          <Link2 className="w-5 h-5 text-warning mb-2" />
          <p className="text-2xl font-bold text-surface-50">{summary?.uncorrelated_devices ?? 0}</p>
          <p className="text-xs text-surface-400">Uncorrelated</p>
        </div>
      </div>

      {/* Protocol Breakdown */}
      {protocols.length > 0 && (
        <div className="oa-panel rounded-md p-6">
          <h3 className="text-lg font-semibold text-surface-50 mb-4">Protocols Detected</h3>
          <div className="flex flex-wrap gap-3">
            {protocols.map((p) => (
              <div key={p.protocol} className="px-3 py-2 bg-surface-700/50 border border-surface-600 rounded-lg">
                <span className="text-sm font-medium text-surface-50">{p.protocol}</span>
                <span className="ml-2 text-xs text-surface-400">({p.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovered Devices Table */}
      <div className="oa-panel overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700">
          <h3 className="text-lg font-semibold text-surface-50">Discovered Devices</h3>
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
