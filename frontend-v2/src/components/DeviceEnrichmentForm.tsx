import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import type { DeviceRecord } from './DiscoveredDeviceInspector';

const fields = [
  ['hostname', 'Hostname'], ['device_class', 'Device class'], ['manufacturer', 'Manufacturer'],
  ['model', 'Model'], ['firmware_version', 'Firmware version'], ['ot_device_type', 'OT device type'],
] as const;
type Editable = typeof fields[number][0] | 'notes' | 'confidence' | 'tags';

function initial(record: DeviceRecord): Record<Editable, string> {
  return { hostname: record.hostname ?? '', device_class: record.device_class ?? '', manufacturer: record.manufacturer ?? '',
    model: record.model ?? '', firmware_version: record.firmware_version ?? '', ot_device_type: record.ot_device_type ?? '',
    notes: record.notes ?? '', confidence: record.confidence ?? '', tags: record.tags?.join(', ') ?? '' };
}

export function DeviceEnrichmentForm({ record, onSaved, onCancel, onBusy }: {
  record: DeviceRecord; onSaved: (updated: DeviceRecord) => void; onCancel: () => void; onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => initial(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const original = initial(record);
  const changed = (Object.keys(draft) as Editable[]).filter(key => draft[key] !== original[key]);
  const fieldClass = 'mt-1 w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100';
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !changed.length) return;
    const update: Record<string, unknown> = {};
    for (const key of changed) update[key] = key === 'tags' ? [...new Set(draft.tags.split(',').map(tag => tag.trim()).filter(Boolean))] : draft[key].trim() || null;
    pending.current = true; setSaving(true); onBusy(true); setError('');
    try {
      const response = await apiClient.patch<DeviceRecord>(`/ot/discovered-devices/${record.id}`, update);
      if (!active.current) return;
      if (response.data.id !== record.id) throw new Error('The saved response did not match this device. Reload its details before trying again.');
      onBusy(false); onSaved(response.data);
    } catch (err) {
      if (active.current) setError(getApiErrorMessage(err, 'Manual enrichment could not be saved. Your changes remain below.'));
    } finally { pending.current = false; if (active.current) { setSaving(false); onBusy(false); } }
  };
  return <form aria-label="Manual device enrichment" onSubmit={event => { void save(event); }} className="space-y-3 rounded border border-primary-500/30 p-3">
    <p className="text-sm font-semibold text-surface-100">Review manual enrichment for device #{record.id}</p>
    <p className="text-xs text-surface-400">Save only the fields you change. Empty text clears that field. This does not edit the linked managed asset, confirm a fingerprint or run a scan.</p>
    <fieldset disabled={saving} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => <label key={key} className="text-xs text-surface-300">{label}<input aria-label={`Enrichment ${label}`} maxLength={500} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className={fieldClass} /></label>)}
        <label className="text-xs text-surface-300">Identification confidence<select aria-label="Enrichment confidence" value={draft.confidence} onChange={event => setDraft({ ...draft, confidence: event.target.value })} className={fieldClass}><option value="">Not recorded</option>{draft.confidence && !['low','medium','high','critical'].includes(draft.confidence) && <option value={draft.confidence}>{draft.confidence} (recorded)</option>}{['low','medium','high','critical'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs text-surface-300">Tags, comma separated<input aria-label="Enrichment tags" value={draft.tags} maxLength={2000} onChange={event => setDraft({ ...draft, tags: event.target.value })} className={fieldClass} /></label>
      </div>
      <label className="block text-xs text-surface-300">Analyst notes<textarea aria-label="Enrichment notes" rows={3} maxLength={10000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} className={fieldClass} /></label>
      <p role="status" className="text-xs text-surface-400">{changed.length} changed {changed.length === 1 ? 'field' : 'fields'}. Observed last-seen time is not changed by this edit.</p>
      {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={!changed.length} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{saving ? 'Saving enrichment...' : 'Save manual enrichment'}</button><button type="button" onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Cancel enrichment</button></div>
    </fieldset>
  </form>;
}
