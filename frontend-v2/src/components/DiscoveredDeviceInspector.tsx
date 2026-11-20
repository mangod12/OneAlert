import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { DeviceEnrichmentForm } from './DeviceEnrichmentForm';
import { useDialogFocus } from './ui/useDialogFocus';

export interface DeviceRecord {
  id: number;
  ip_address: string;
  hostname?: string | null;
  mac_address?: string | null;
  device_class?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  firmware_version?: string | null;
  serial_number?: string | null;
  is_ot_device?: boolean | null;
  ot_device_type?: string | null;
  confidence?: string | null;
  discovery_method?: string | null;
  sensor_id?: number | null;
  asset_id?: number | null;
  is_correlated?: boolean;
  correlation_score?: number | null;
  risk_score?: number | null;
  risk_factors?: string[] | null;
  ports_open?: number[] | null;
  services_detected?: string[] | null;
  protocols?: string[] | null;
  industrial_protocols?: string[] | null;
  first_seen?: string | null;
  last_seen?: string | null;
  description?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

function recordedTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function items(value?: (string | number)[] | null) { return value?.length ? value.join(', ') : null; }

export function DiscoveredDeviceInspector({ deviceId, onClose, onUpdated, onCopyLink, copyLinkError, copiedLink }: { deviceId: number; onClose: () => void; onUpdated?: () => void; onCopyLink?: () => void; copyLinkError?: string; copiedLink?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  useDialogFocus(dialog, () => { if (!saving) onClose(); });
  const [record, setRecord] = useState<DeviceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setRecord(null); setError(''); setEditing(false); setSaving(false);
    void apiClient.get<DeviceRecord>(`/ot/discovered-devices/${deviceId}`).then(response => {
      if (!active) return;
      if (response.data.id !== deviceId) throw new Error('The response did not match this device. Try again.');
      setRecord(response.data);
    }).catch(err => { if (active) setError(getApiErrorMessage(err, 'Recorded device details could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [deviceId, retry]);

  const fields = record ? [
    ['IP address', record.ip_address], ['MAC address', record.mac_address],
    ['Device class', record.device_class], ['Manufacturer', record.manufacturer],
    ['Model', record.model], ['Firmware version', record.firmware_version],
    ['Serial number', record.serial_number], ['Environment', record.is_ot_device === true ? 'OT / ICS' : record.is_ot_device === false ? 'IT / other' : null],
    ['OT device type', record.ot_device_type], ['Identification confidence', record.confidence],
    ['Discovery method', record.discovery_method], ['Source sensor ID', record.sensor_id == null ? null : String(record.sensor_id)],
    ['Correlation', record.is_correlated === true ? 'Correlated' : record.is_correlated === false ? 'Unmatched' : null],
    ['Managed asset ID', record.asset_id == null ? null : String(record.asset_id)],
    ['Correlation score', record.correlation_score == null ? null : String(record.correlation_score)],
    ['Recorded risk score', record.risk_score == null ? null : String(record.risk_score)],
    ['Risk factors', items(record.risk_factors)], ['Open ports (recorded)', items(record.ports_open)],
    ['Services detected', items(record.services_detected)], ['Protocols', items(record.protocols)],
    ['Industrial protocols', items(record.industrial_protocols)], ['Tags', items(record.tags)],
    ['First seen', recordedTime(record.first_seen)], ['Last seen', recordedTime(record.last_seen)],
  ] : [];

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="device-inspector-heading" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="device-inspector-heading" className="min-w-0 break-words text-lg font-semibold text-surface-50">Discovered device #{deviceId}</h2>
        <button type="button" disabled={saving} onClick={onClose} className="shrink-0 rounded-md border border-surface-600 px-3 py-1.5 text-sm text-surface-200">Close details</button>
      </div>
      <p className="mt-2 text-sm text-surface-400">Fingerprints, ports, risk and timestamps are recorded evidence, not a live scan or connectivity check. Manual enrichment changes only the selected inventory fields, not observed ports, risk, source or timestamps.</p>
      {onCopyLink && <div className="mt-3 space-y-2"><button type="button" disabled={saving} onClick={onCopyLink} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Copy device record link</button><p className="text-xs text-surface-400">The link opens this record by ID, not an IP search or frozen snapshot. It does not grant access. Recipients must already have permission to view this inventory record.</p>{copiedLink && <p role="status" className="text-xs text-primary-300">Device record link copied.</p>}{copyLinkError && <p role="alert" className="text-xs text-danger">{copyLinkError}</p>}</div>}
      {loading && <p role="status" className="mt-5 text-sm text-surface-300">Loading recorded device details...</p>}
      {error && <div className="mt-5 space-y-3"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200">Retry device details</button></div>}
      {!loading && !error && record && <div className="mt-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="break-words text-base font-semibold text-surface-50">{record.hostname || record.ip_address}</h3>
          {!editing && <button type="button" onClick={() => setEditing(true)} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Review manual enrichment</button>}
        </div>
        {editing && <DeviceEnrichmentForm key={record.id} record={record} onBusy={setSaving} onCancel={() => setEditing(false)} onSaved={updated => { setRecord(updated); setEditing(false); onUpdated?.(); }} /> }
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-surface-400">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-surface-100">{value || 'Not recorded'}</dd></div>)}
        </dl>
        <section><h3 className="text-sm font-semibold text-surface-100">Description</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-surface-300">{record.description || 'Not recorded'}</p></section>
        <section><h3 className="text-sm font-semibold text-surface-100">Notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-surface-300">{record.notes || 'Not recorded'}</p></section>
      </div>}
    </div>
  </div>;
}
